from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx
from fastapi import HTTPException

from .config import settings

MODEL_DEFAULTS = {
    "gemini": settings.gemini_models,
    "groq": settings.groq_models,
}
_cooldowns: dict[str, float] = {}
_cooldown_lock = threading.Lock()
logger = logging.getLogger(__name__)


def provider_cooling_down(provider: str) -> bool:
    with _cooldown_lock:
        return _cooldowns.get(provider, 0) > time.monotonic()


def cool_down(provider: str, seconds: int = 45) -> None:
    with _cooldown_lock:
        _cooldowns[provider] = time.monotonic() + seconds


def provider_key(provider: str) -> str:
    if provider == "gemini":
        return settings.gemini_key
    if provider == "groq":
        return settings.groq_key
    return ""


def embedding_key() -> str:
    return settings.embedding_key or provider_key("gemini")


def configured_providers() -> list[str]:
    return [provider for provider in MODEL_DEFAULTS if provider_key(provider)]


def _provider_error(response: httpx.Response) -> HTTPException:
    message = f"AI provider request failed ({response.status_code})."
    try:
        body = response.json()
        detail = body.get("error", {})
        if isinstance(detail, dict):
            message = str(detail.get("message") or message)
        elif detail:
            message = str(detail)
    except ValueError:
        pass
    if response.status_code in (401, 403):
        status_code = 502
        message = "The selected AI provider rejected its configured credential."
    elif response.status_code == 429:
        status_code = 429
        message = "The selected AI provider is rate limited."
    elif response.status_code >= 500:
        status_code = 503
        message = "The selected AI provider is temporarily unavailable."
    else:
        status_code = 502
    headers = {"X-Notez-Provider-Error": "credential"} if response.status_code in (401, 403) else None
    return HTTPException(status_code=status_code, detail=message, headers=headers)


async def generate(
    provider: str,
    model: str,
    api_key: str,
    prompt: str,
    system_prompt: str,
    temperature: float,
    json_mode: bool,
    images: list[dict[str, str]],
) -> dict[str, str]:
    if provider not in MODEL_DEFAULTS:
        raise HTTPException(status_code=422, detail="Unsupported AI provider.")
    if not api_key:
        raise HTTPException(status_code=503, detail="No credential is configured for the selected AI provider.")
    if model not in MODEL_DEFAULTS[provider]:
        raise HTTPException(status_code=422, detail="The requested model is not enabled for this provider.")

    timeout = httpx.Timeout(settings.request_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "groq":
            content: Any = prompt
            if images:
                raise HTTPException(status_code=422, detail="Groq image input is not enabled by this Notez adapter.")
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "temperature": temperature,
                    "messages": [
                        {"role": "system", "content": f"{system_prompt}\n\nThe actual generation provider is Groq and the model is {model}."},
                        {"role": "user", "content": content},
                    ],
                },
            )
            if not response.is_success:
                raise _provider_error(response)
            data = response.json()
            text = str(data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            if data.get("choices", [{}])[0].get("finish_reason") == "length":
                raise HTTPException(status_code=502, detail="The AI answer was cut off.")
        else:
            parts: list[dict[str, Any]] = [{"text": prompt}]
            for image in images:
                parts.append({"inlineData": {"mimeType": image["mime"], "data": image["data"]}})
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                json={
                    "systemInstruction": {"parts": [{"text": f"{system_prompt}\n\nThe actual generation provider is Gemini and the model is {model}."}]},
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": {
                        "temperature": temperature,
                        **({"responseMimeType": "application/json"} if json_mode else {}),
                    },
                },
            )
            if not response.is_success:
                raise _provider_error(response)
            data = response.json()
            candidate = (data.get("candidates") or [{}])[0]
            text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", []))
            text = text.strip()
            finish = candidate.get("finishReason")
            if text and finish and finish != "STOP":
                raise HTTPException(status_code=502, detail="The AI answer was cut off.")
            if not text and data.get("promptFeedback", {}).get("blockReason"):
                raise HTTPException(status_code=422, detail="The request was blocked by the provider's safety filters.")
    if not text:
        raise HTTPException(status_code=502, detail="The AI provider returned an empty answer.")
    return {"text": text, "provider": provider, "model": model}


async def embed_texts(texts: list[str]) -> list[list[float]]:
    key = embedding_key()
    if not key:
        raise HTTPException(status_code=503, detail="Semantic indexing is not configured with an embedding credential.")
    requests = [
        {
            "model": f"models/{settings.embedding_model}",
            "content": {"parts": [{"text": text}]},
            "outputDimensionality": settings.embedding_dimensions,
        }
        for text in texts
    ]
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{settings.embedding_model}:batchEmbedContents",
                params={"key": key},
                json={"requests": requests},
            )
    except httpx.RequestError as exc:
        logger.warning("Gemini embedding request failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Could not reach the Gemini embedding service. Try again shortly.") from exc
    if not response.is_success:
        raise _provider_error(response)
    data = response.json()
    vectors = [item.get("values", []) for item in data.get("embeddings", [])]
    if len(vectors) != len(texts) or any(len(vector) != settings.embedding_dimensions for vector in vectors):
        raise HTTPException(status_code=502, detail="The embedding provider returned an incompatible vector dimension.")
    return vectors


async def embed_query(text: str) -> list[float]:
    vectors = await embed_texts([text])
    return vectors[0]
