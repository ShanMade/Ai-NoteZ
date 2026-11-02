from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import sqlite3
import time
from collections import defaultdict, deque
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from .auth import AuthenticatedUser
from .config import settings
from .firebase import user_note, user_notes
from .vector_store import HnswIndexManager, note_text
from .providers import MODEL_DEFAULTS, configured_providers, cool_down, embed_query, embed_texts, generate, provider_cooling_down, provider_key

index_manager = HnswIndexManager()
logger = logging.getLogger(__name__)

app = FastAPI(title="Notez AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After"],
    max_age=600,
)
NOTE_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


class RequestLimiter:
    def __init__(self, limit: int = 30, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self.calls: dict[str, deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def check(self, uid: str) -> None:
        now = time.monotonic()
        async with self.lock:
            queue = self.calls[uid]
            while queue and queue[0] <= now - self.window_seconds:
                queue.popleft()
            if len(queue) >= self.limit:
                retry_after = max(1, int(queue[0] + self.window_seconds - now + 0.999))
                raise HTTPException(
                    status_code=429,
                    detail="Notez AI request limit reached. Try again shortly.",
                    headers={"Retry-After": str(retry_after)},
                )
            queue.append(now)


limiter = RequestLimiter(settings.rate_limit_requests, settings.rate_limit_window_seconds)
guest_limiter = RequestLimiter(settings.guest_rate_limit_requests, settings.guest_rate_limit_window_seconds)


def is_anonymous_user(user: dict) -> bool:
    firebase_claims = user.get("firebase")
    return isinstance(firebase_claims, dict) and firebase_claims.get("sign_in_provider") == "anonymous"


async def rate_limit(user: AuthenticatedUser) -> dict:
    active_limiter = guest_limiter if is_anonymous_user(user) else limiter
    await active_limiter.check(str(user["uid"]))
    return user


RateLimitedUser = Annotated[dict, Depends(rate_limit)]


@app.middleware("http")
async def request_limits(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH"}:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > 8_000_000:
                    return _json_error(413, "Request body exceeds the Notez API size limit.")
            except ValueError:
                return _json_error(400, "Invalid Content-Length header.")
    return await call_next(request)


def _json_error(code: int, detail: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=code, content={"detail": detail})


class ImagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mime: str = Field(min_length=1, max_length=80)
    data: str = Field(min_length=1, max_length=1_500_000)

    @field_validator("mime")
    @classmethod
    def image_only(cls, value: str) -> str:
        if not value.startswith("image/"):
            raise ValueError("Only image inputs are supported.")
        return value


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(default="gemini", min_length=1, max_length=30)
    model: str = Field(default="", max_length=120)
    prompt: str = Field(min_length=1, max_length=settings.max_prompt_chars)
    system_prompt: str = Field(default="", max_length=4000)
    temperature: float = Field(default=0.4, ge=0, le=2)
    json_mode: bool = Field(default=False, alias="json")
    images: list[ImagePayload] = Field(default_factory=list, max_length=4)
    api_key: SecretStr | None = Field(default=None, repr=False)


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=5, ge=1, le=settings.max_search_results)


def _validate_note_id(note_id: str) -> None:
    if not NOTE_ID.fullmatch(note_id):
        raise HTTPException(status_code=422, detail="Invalid note identifier.")


@app.get("/healthz")
async def health():
    return {
        "status": "ok",
        "vectorStore": "usearch-hnsw",
    }


@app.get("/v1/config")
async def public_config(user: AuthenticatedUser):
    return {
        "defaultProvider": settings.default_provider,
        "managedProviders": configured_providers(),
        "embeddingEnabled": bool(settings.embedding_key or settings.gemini_key),
        "capabilities": {
            "generate": True,
            "images": True,
            "semanticSearch": bool(settings.embedding_key or settings.gemini_key),
        },
    }


@app.post("/v1/ai/generate", dependencies=[Depends(rate_limit)])
async def ai_generate(body: GenerateRequest, user: AuthenticatedUser):
    if is_anonymous_user(user):
        if len(body.prompt) > settings.guest_max_prompt_chars:
            raise HTTPException(status_code=413, detail="Guest AI prompts are limited to a shorter length.")
        if body.images:
            raise HTTPException(status_code=403, detail="Image requests are not available in guest mode.")
    byok = body.api_key.get_secret_value().strip() if body.api_key else ""
    if byok:
        return await generate(
            body.provider,
            body.model or MODEL_DEFAULTS.get(body.provider, ("",))[0],
            byok,
            body.prompt,
            body.system_prompt,
            body.temperature,
            body.json_mode,
            [image.model_dump() for image in body.images],
        )

    providers = configured_providers()
    ordered = [settings.default_provider, *[item for item in providers if item != settings.default_provider]]
    ordered = [item for item in ordered if item in providers and not provider_cooling_down(item)]
    if not providers:
        raise HTTPException(status_code=503, detail="Application-managed AI is not configured on this backend. Set AI_GEMINI_API_KEY or AI_GROQ_API_KEY in the backend environment.")
    if not ordered:
        raise HTTPException(status_code=503, detail="Configured AI providers are cooling down after rate limits. Try again shortly.")
    last_error: HTTPException | None = None
    for index, provider in enumerate(ordered):
        model = body.model if provider == body.provider and body.model else MODEL_DEFAULTS[provider][0]
        try:
            return await generate(provider, model, provider_key(provider), body.prompt, body.system_prompt, body.temperature, body.json_mode, [image.model_dump() for image in body.images])
        except HTTPException as exc:
            last_error = exc
            if exc.headers and exc.headers.get("X-Notez-Provider-Error") == "credential":
                raise
            if exc.status_code in {429, 503}:
                cool_down(provider, seconds=45 if exc.status_code == 429 else 15)
            if exc.status_code not in {429, 503} or index == len(ordered) - 1:
                raise
    raise last_error or HTTPException(status_code=503, detail="No AI provider is currently available.")


@app.post("/v1/index/notes/{note_id}", dependencies=[Depends(rate_limit)])
async def index_note(note_id: str, user: RateLimitedUser):
    _validate_note_id(note_id)
    uid = str(user["uid"])
    try:
        note = await asyncio.to_thread(user_note, uid, note_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not note:
        raise HTTPException(status_code=404, detail="The note does not exist in this user's Realtime Database.")
    try:
        changed = await index_manager.upsert(uid, note_id, note, embed_texts)
    except (OSError, sqlite3.Error) as exc:
        logger.exception("Semantic index storage failed during note update")
        raise HTTPException(status_code=503, detail="Semantic index storage is unavailable. Try refreshing the index later.") from exc
    return {"indexed": changed, "noteId": note_id}


@app.delete("/v1/index/notes/{note_id}", dependencies=[Depends(rate_limit)])
async def delete_indexed_note(note_id: str, user: RateLimitedUser):
    _validate_note_id(note_id)
    deleted = await index_manager.delete(str(user["uid"]), note_id)
    return {"deleted": deleted, "noteId": note_id}


@app.post("/v1/index/rebuild", dependencies=[Depends(rate_limit)])
async def rebuild_index(user: RateLimitedUser):
    uid = str(user["uid"])
    try:
        notes = await asyncio.to_thread(user_notes, uid)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    normalized = {str(note_id): note for note_id, note in notes.items() if isinstance(note, dict) and NOTE_ID.fullmatch(str(note_id))}
    try:
        count = await index_manager.rebuild(uid, normalized, embed_texts)
    except (OSError, sqlite3.Error) as exc:
        logger.exception("Semantic index storage failed during rebuild")
        raise HTTPException(status_code=503, detail="Semantic index storage is unavailable. Try refreshing the index later.") from exc
    return {"indexedChunks": count, "indexedNotes": len(normalized)}


@app.post("/v1/index/search", dependencies=[Depends(rate_limit)])
async def search_index(body: SearchRequest, user: AuthenticatedUser):
    uid = str(user["uid"])
    vector = await embed_query(body.query)
    results = await index_manager.search(uid, vector, body.limit)
    verified = []
    for result in results:
        try:
            source = await asyncio.to_thread(user_note, uid, result["id"])
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if not source:
            continue
        digest = hashlib.sha256(note_text(source).encode("utf-8")).hexdigest()
        if digest != result.pop("contentHash"):
            continue
        verified.append(result)
    return {"results": verified}
