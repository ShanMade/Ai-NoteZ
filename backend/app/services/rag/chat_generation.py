from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ...core.config import settings
from ...services.recording.transcription import _api_key

logger = logging.getLogger(__name__)
_GEMINI_STREAM_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"


async def stream_answer(
    *,
    question: str,
    excerpts: list[dict[str, str]],
    history: list[dict[str, str]],
) -> AsyncIterator[str]:
    api_key = _api_key()
    if not api_key:
        raise RuntimeError("Configure GEMINI_API_KEY or AI_GEMINI_API_KEY to enable AI chat.")
    source_block = "\n\n".join(
        f"[{index}] {excerpt['title']}\n{excerpt['text']}"
        for index, excerpt in enumerate(excerpts, start=1)
    )
    contents: list[dict[str, Any]] = [
        {
            "role": "model" if turn["role"] == "assistant" else "user",
            "parts": [{"text": turn["content"]}],
        }
        for turn in history[-10:]
        if turn.get("role") in {"user", "assistant"}
    ]
    contents.append(
        {
            "role": "user",
            "parts": [
                {
                    "text": f"""Answer the question using only the numbered source excerpts below.
If the excerpts do not support an answer, say so plainly. Cite each factual claim with its source
number in [n] form. Never invent a citation number or claim that is not supported.

Question: {question}

Source excerpts:
{source_block}"""
                }
            ],
        }
    )
    payload = {
        "systemInstruction": {
            "parts": [
                {
                    "text": "You are Notez, a careful assistant grounded in the user's own notes. Be concise, "
                    "distinguish evidence from uncertainty, and cite supported statements with [n]."
                }
            ]
        },
        "contents": contents,
        "generationConfig": {"temperature": 0.2},
    }
    url = _GEMINI_STREAM_URL.format(model=settings.ai_chat_model)
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15)) as client:
        async with client.stream(
            "POST",
            url,
            params={"key": api_key, "alt": "sse"},
            json=payload,
        ) as response:
            if not response.is_success:
                body = await response.aread()
                logger.warning("Gemini chat stream failed with HTTP %s.", response.status_code)
                raise RuntimeError(f"Gemini chat failed with HTTP {response.status_code}: {body[:200].decode(errors='replace')}")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise RuntimeError("Gemini returned a malformed chat stream event.") from exc
                candidate = (event.get("candidates") or [{}])[0]
                if candidate.get("finishReason") == "SAFETY":
                    raise RuntimeError("Gemini blocked the response with its safety filters.")
                for part in candidate.get("content", {}).get("parts", []):
                    text = part.get("text")
                    if isinstance(text, str) and text:
                        yield text
