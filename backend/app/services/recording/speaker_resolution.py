from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import SessionSpeaker, TranscriptSegment
from .transcription import DiarizedSegment

_TOKEN = re.compile(r"[^\w']+", re.UNICODE)
_STOP_WORDS = {
    "about",
    "after",
    "and",
    "are",
    "because",
    "but",
    "for",
    "from",
    "have",
    "into",
    "just",
    "like",
    "that",
    "the",
    "their",
    "then",
    "there",
    "this",
    "what",
    "when",
    "with",
    "you",
}


def _normalize_label(label: str) -> str:
    return " ".join(label.casefold().split())


def _tokens(text: str) -> set[str]:
    return {token for token in _TOKEN.split(text.casefold()) if len(token) > 2 and token not in _STOP_WORDS}


def _text_similarity(left: str, right: str) -> float:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


async def resolve_part(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    part_index: int,
    gemini_result: list[DiarizedSegment],
    role_assignments: dict[str, str] | None = None,
) -> list[TranscriptSegment]:
    result = await db.execute(
        select(SessionSpeaker)
        .where(SessionSpeaker.session_id == session_id)
        .order_by(SessionSpeaker.first_seen_part, SessionSpeaker.created_at, SessionSpeaker.id)
    )
    known_speakers = list(result.scalars().all())
    matched_segment_speakers: dict[str, SessionSpeaker] = {}
    resolved: list[TranscriptSegment] = []

    for segment in gemini_result:
        normalized_label = _normalize_label(segment.label)
        speaker = next(
            (
                known
                for known in known_speakers
                if _normalize_label(known.gemini_label) == normalized_label
                or _normalize_label(known.display_name) == normalized_label
            ),
            None,
        )

        if speaker is None:
            candidates = [
                (known, _text_similarity(segment.text, known.sample_text))
                for known in known_speakers
                if known.role is not None and not known.user_confirmed
            ]
            best_match = max(candidates, key=lambda item: item[1], default=(None, 0.0))
            # Text similarity is only weak evidence; require strong overlap and a structured role.
            if best_match[0] is not None and best_match[1] >= 0.72:
                speaker = best_match[0]

        if speaker is None:
            display_name = segment.label
            if normalized_label.startswith(("voice ", "speaker ")):
                display_name = f"Voice {len(known_speakers) + 1}"
            speaker = SessionSpeaker(
                session_id=session_id,
                gemini_label=segment.label,
                display_name=display_name,
                sample_text=segment.text[:200],
                first_seen_part=part_index,
            )
            db.add(speaker)
            await db.flush()
            known_speakers.append(speaker)
        elif len(speaker.sample_text) < 200 and segment.text:
            speaker.sample_text = f"{speaker.sample_text} {segment.text}".strip()[:200]

        matched_segment_speakers[segment.label] = speaker
        resolved.append(
            TranscriptSegment(
                session_id=session_id,
                part_index=part_index,
                speaker_id=speaker.id,
                raw_gemini_label=segment.label,
                text=segment.text,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
            )
        )

    if role_assignments:
        for label, role in role_assignments.items():
            speaker = matched_segment_speakers.get(label)
            if speaker is not None and speaker.first_seen_part == part_index and not speaker.user_confirmed:
                speaker.role = role

    db.add_all(resolved)
    await db.flush()
    return resolved
