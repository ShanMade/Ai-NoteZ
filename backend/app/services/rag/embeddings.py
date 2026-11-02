from __future__ import annotations

import asyncio
import logging
import math
from typing import Any

import httpx

from ...core.config import settings
from ...services.recording.transcription import _api_key

logger = logging.getLogger(__name__)
_BATCH_SIZE = 100
_MAX_ATTEMPTS = 4
_GEMINI_EMBEDDING_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"


async def _embed_batch(texts: list[str], task_type: str) -> list[list[float]]:
    if not texts:
        return []
    key = _api_key()
    if not key:
        raise RuntimeError("Configure GEMINI_API_KEY or AI_GEMINI_API_KEY for semantic indexing.")
    requests = [
        {
            "model": f"models/{settings.embedding_model}",
            "content": {"parts": [{"text": text}]},
            "taskType": task_type,
            "outputDimensionality": settings.embedding_dimensions,
        }
        for text in texts
    ]
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15)) as client:
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await client.post(
                    _GEMINI_EMBEDDING_URL.format(model=settings.embedding_model),
                    params={"key": key},
                    json={"requests": requests},
                )
            except httpx.RequestError as exc:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise RuntimeError("Could not reach the Gemini embedding service.") from exc
                await asyncio.sleep(2**attempt)
                continue
            if response.status_code == 429:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise RuntimeError("Gemini embeddings remained rate limited after retries.")
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = max(1, min(30, int(float(retry_after)))) if retry_after else 2**attempt
                except ValueError:
                    delay = 2**attempt
                await asyncio.sleep(delay)
                continue
            if not response.is_success:
                logger.warning("Gemini embedding request failed with HTTP %s.", response.status_code)
                raise RuntimeError(f"Gemini embedding failed with HTTP {response.status_code}.")
            try:
                data: Any = response.json()
            except ValueError as exc:
                raise RuntimeError("Gemini embedding response was not valid JSON.") from exc
            vectors = [item.get("values", []) for item in data.get("embeddings", [])]
            if len(vectors) != len(texts):
                raise RuntimeError("Gemini returned an incompatible number of embedding vectors.")
            if any(
                len(vector) != settings.embedding_dimensions
                or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
                for vector in vectors
            ):
                raise RuntimeError("Gemini returned an incompatible embedding vector dimension.")
            return vectors
    raise RuntimeError("Gemini embedding did not complete.")


async def embed_documents(texts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for offset in range(0, len(texts), _BATCH_SIZE):
        vectors.extend(await _embed_batch(texts[offset : offset + _BATCH_SIZE], "RETRIEVAL_DOCUMENT"))
    return vectors


async def embed_query(text: str) -> list[float]:
    vectors = await _embed_batch([text], "RETRIEVAL_QUERY")
    return vectors[0]
