from __future__ import annotations

import base64
from dataclasses import dataclass
import json
import logging
from typing import Any

import httpx

from ...core.config import settings

logger = logging.getLogger(__name__)
_GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class TranscriptionRateLimited(Exception):
    def __init__(self, *, retry_after: int):
        self.retry_after = retry_after


@dataclass(frozen=True)
class DiarizedSegment:
    label: str
    text: str
    start_ms: int
    end_ms: int


def _api_key() -> str:
    if settings.gemini_api_key is not None:
        key = settings.gemini_api_key.get_secret_value().strip()
        if key:
            return key
    from ...config import settings as legacy_settings

    return legacy_settings.gemini_key.strip()


def _known_speaker_context(speakers: list[dict[str, str | None]]) -> str:
    if not speakers:
        return "No speakers have been identified yet."
    lines = [
        f'- Speaker "{speaker["display_name"]}" (role: {speaker["role"] or "unknown"}) — '
        f'example: "{(speaker["sample_text"] or "")[:200]}"'
        for speaker in speakers
    ]
    return "\n".join(lines)


def _parse_segments(response: dict[str, Any]) -> list[DiarizedSegment]:
    try:
        parts = response["candidates"][0]["content"]["parts"]
        text = next(part["text"] for part in parts if isinstance(part.get("text"), str))
        payload = json.loads(text)
        raw_segments = payload["segments"]
    except (KeyError, IndexError, StopIteration, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Gemini returned an invalid diarized transcript.") from exc
    if not isinstance(raw_segments, list):
        raise ValueError("Gemini transcript segments must be a list.")

    segments: list[DiarizedSegment] = []
    for item in raw_segments:
        if not isinstance(item, dict):
            raise ValueError("Gemini returned a malformed transcript segment.")
        label = item.get("speaker")
        content = item.get("text")
        start_ms = item.get("start_ms")
        end_ms = item.get("end_ms")
        if (
            not isinstance(label, str)
            or not label.strip()
            or not isinstance(content, str)
            or not content.strip()
            or not isinstance(start_ms, int)
            or not isinstance(end_ms, int)
            or start_ms < 0
            or end_ms < start_ms
        ):
            raise ValueError("Gemini returned a malformed transcript segment.")
        segments.append(DiarizedSegment(label.strip()[:160], content.strip(), start_ms, end_ms))
    return segments


async def _generate_content(
    *,
    model: str,
    prompt: str,
    audio: bytes | None = None,
    content_type: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    api_key = _api_key()
    if not api_key:
        raise RuntimeError("Configure GEMINI_API_KEY or AI_GEMINI_API_KEY to enable transcription.")
    parts: list[dict[str, Any]] = [{"text": prompt}]
    if audio is not None:
        parts.append(
            {
                "inline_data": {
                    "mime_type": content_type or "audio/wav",
                    "data": base64.b64encode(audio).decode("ascii"),
                }
            }
        )
    request_payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    url = _GEMINI_ENDPOINT.format(model=model)
    owns_client = client is None
    active_client = client or httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0))
    try:
        response = await active_client.post(
            url,
            params={"key": api_key},
            json=request_payload,
        )
        if response.status_code == 429:
            try:
                retry_after = max(1, int(float(response.headers.get("Retry-After", "65"))))
            except ValueError:
                retry_after = 65
            raise TranscriptionRateLimited(retry_after=retry_after)
        if response.is_error:
            logger.warning("Gemini transcription request failed with HTTP %s.", response.status_code)
            raise RuntimeError(f"Gemini transcription failed with HTTP {response.status_code}.")
        try:
            result = response.json()
        except ValueError as exc:
            raise ValueError("Gemini returned a non-JSON response.") from exc
        if not isinstance(result, dict):
            raise ValueError("Gemini returned an invalid response.")
        return result
    finally:
        if owns_client:
            await active_client.aclose()


async def transcribe_audio(
    audio: bytes,
    *,
    content_type: str,
    part_index: int,
    context_prompt: str | None,
    known_speakers: list[dict[str, str | None]],
    client: httpx.AsyncClient | None = None,
) -> list[DiarizedSegment]:
    prompt = f"""Transcribe this audio accurately and diarize each audible speaker.
This is part {part_index} of an ongoing recording.
Recording context: {context_prompt or "general conversation"}

Known speakers so far:
{_known_speaker_context(known_speakers)}

Use the exact existing speaker name when the voice matches a known speaker. Do not assign a
known identity based only on what the speaker says; compare the audible voice. Introduce a new
descriptive label only for a voice that is genuinely new. Return only JSON in this shape:
{{"segments":[{{"speaker":"Speaker name or new voice label","text":"spoken words",
"start_ms":0,"end_ms":1200}}]}}. Times are offsets from the beginning of this audio part.
Return an empty segments array when there is no intelligible speech."""
    response = await _generate_content(
        model=settings.gemini_transcription_model,
        prompt=prompt,
        audio=audio,
        content_type=content_type,
        client=client,
    )
    return _parse_segments(response)


async def classify_speaker_roles(
    segments: list[dict[str, str | int]],
    *,
    context_prompt: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, str]:
    prompt = f"""Given this recording context and transcript, assign roles only when the evidence
is clear. Return JSON mapping speaker labels to a short role, or an empty object when uncertain.
The context can indicate a classroom, interview, meeting, or another structured scenario.
Context: {context_prompt}
Transcript:
{json.dumps(segments, ensure_ascii=False)}
Example output: {{"Sir Bilal":"teacher","Voice 2":"student"}}"""
    response = await _generate_content(
        model=settings.ai_chat_model,
        prompt=prompt,
        client=client,
    )
    try:
        parts = response["candidates"][0]["content"]["parts"]
        text = next(part["text"] for part in parts if isinstance(part.get("text"), str))
        roles = json.loads(text)
    except (KeyError, IndexError, StopIteration, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Gemini returned invalid speaker role classifications.") from exc
    if not isinstance(roles, dict):
        raise ValueError("Gemini speaker role classifications must be a JSON object.")
    return {
        label.strip()[:160]: role.strip()[:80]
        for label, role in roles.items()
        if isinstance(label, str) and label.strip() and isinstance(role, str) and role.strip()
    }
