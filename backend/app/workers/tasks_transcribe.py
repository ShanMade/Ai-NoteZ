from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import uuid

from sqlalchemy import select

from ..core.celery_app import celery_app
from ..core.db import AsyncSessionLocal
from ..models import RecordingPart, RecordingSession
from ..repositories.recording import list_speakers
from ..services.recording.completion import finalize_if_ready
from ..services.recording import storage
from ..services.recording.speaker_resolution import resolve_part
from ..services.recording.transcription import (
    DiarizedSegment,
    TranscriptionRateLimited,
    classify_speaker_roles,
    transcribe_audio,
)

logger = logging.getLogger(__name__)
_STRUCTURED_CONTEXT = ("classroom", "teacher", "student", "lecture", "interview", "host", "panel")


def _heuristic_roles(segments: list[DiarizedSegment], context_prompt: str) -> dict[str, str]:
    context = context_prompt.casefold()
    if "teacher" not in context and "classroom" not in context and "lecture" not in context:
        return {}
    word_counts: dict[str, int] = {}
    for segment in segments:
        word_counts[segment.label] = word_counts.get(segment.label, 0) + len(segment.text.split())
    if not word_counts:
        return {}
    teacher_label = max(word_counts, key=word_counts.get)
    return {
        label: "teacher" if label == teacher_label else "student"
        for label in word_counts
    }


async def process_part(session_id: str, part_index: int) -> str | None:
    session_uuid = uuid.UUID(session_id)
    note_id: str | None = None
    async with AsyncSessionLocal() as db:
        async with db.begin():
            query = await db.execute(
                select(RecordingPart, RecordingSession)
                .join(RecordingSession, RecordingPart.session_id == RecordingSession.id)
                .where(
                    RecordingSession.id == session_uuid,
                    RecordingPart.part_index == part_index,
                )
                .with_for_update()
            )
            row = query.one_or_none()
            if row is None:
                raise LookupError("Recording part was not found.")
            part, session = row
            if part.status == "done":
                return await finalize_if_ready(db, session)
            now = datetime.now(timezone.utc)
            updated_at = part.updated_at
            if updated_at.tzinfo is None:
                now = now.replace(tzinfo=None)
            if part.status == "processing" and updated_at > now - timedelta(minutes=10):
                return None
            if part.is_empty:
                part.status = "done"
                note_id = await finalize_if_ready(db, session)
            else:
                part.status = "processing"
                part.attempts += 1
                storage_key = part.storage_key
                content_type = part.content_type
                context_prompt = session.context_prompt

        if note_id is not None or part.is_empty:
            return note_id

        audio = await asyncio.to_thread(storage.read_audio, storage_key)
        speakers = await list_speakers(db, session_id=session_uuid)
        speaker_context = [
            {
                "display_name": speaker.display_name,
                "role": speaker.role,
                "sample_text": speaker.sample_text,
            }
            for speaker in speakers
        ]
        await db.rollback()
        segments = await transcribe_audio(
            audio,
            content_type=content_type,
            part_index=part_index,
            context_prompt=context_prompt,
            known_speakers=speaker_context,
        )

        role_assignments = _heuristic_roles(segments, context_prompt or "")
        context_lower = (context_prompt or "").casefold()
        if any(keyword in context_lower for keyword in _STRUCTURED_CONTEXT) and segments:
            try:
                classified_roles = await classify_speaker_roles(
                    [
                        {"speaker": segment.label, "text": segment.text}
                        for segment in segments
                    ],
                    context_prompt=context_prompt or "",
                )
                role_assignments.update(classified_roles)
            except Exception:
                logger.warning(
                    "Speaker role classification failed for recording part %s; preserving unknown roles.",
                    part_index,
                    exc_info=True,
                )

        async with db.begin():
            result = await db.execute(
                select(RecordingPart, RecordingSession)
                .join(RecordingSession, RecordingPart.session_id == RecordingSession.id)
                .where(
                    RecordingSession.id == session_uuid,
                    RecordingPart.part_index == part_index,
                )
                .with_for_update()
            )
            part, session = result.one()
            if part.status == "done":
                return await finalize_if_ready(db, session)
            await resolve_part(
                db,
                session_id=session_uuid,
                part_index=part_index,
                gemini_result=segments,
                role_assignments=role_assignments,
            )
            part.status = "done"
            part.error_code = None
            session.consecutive_rate_limits = 0
            if session.status == "rate_limited":
                session.status = "processing" if session.finish_requested else "recording"
            note_id = await finalize_if_ready(db, session)
    return note_id


async def _mark_rate_limited(session_id: str, part_index: int) -> int:
    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await db.execute(
                select(RecordingPart, RecordingSession)
                .join(RecordingSession, RecordingPart.session_id == RecordingSession.id)
                .where(
                    RecordingSession.id == uuid.UUID(session_id),
                    RecordingPart.part_index == part_index,
                )
                .with_for_update()
            )
            part, session = result.one()
            part.status = "queued"
            session.consecutive_rate_limits += 1
            if session.consecutive_rate_limits >= 3:
                session.status = "rate_limited"
            return session.consecutive_rate_limits


async def _mark_failed(session_id: str, part_index: int, error_code: str) -> str | None:
    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await db.execute(
                select(RecordingPart, RecordingSession)
                .join(RecordingSession, RecordingPart.session_id == RecordingSession.id)
                .where(
                    RecordingSession.id == uuid.UUID(session_id),
                    RecordingPart.part_index == part_index,
                )
                .with_for_update()
            )
            part, session = result.one()
            part.status = "failed"
            part.error_code = error_code[:64]
            audio_key = part.storage_key
            note_id = await finalize_if_ready(db, session)
    try:
        durable_key = await asyncio.to_thread(storage.migrate_audio_to_r2, audio_key)
    except Exception:
        logger.exception("Could not preserve failed audio for recording part %s.", part_index)
    else:
        if durable_key != audio_key:
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    result = await db.execute(
                        select(RecordingPart).where(
                            RecordingPart.session_id == uuid.UUID(session_id),
                            RecordingPart.part_index == part_index,
                        )
                    )
                    part = result.scalar_one()
                    part.storage_key = durable_key
    return note_id


@celery_app.task(name="transcription.transcribe_part", bind=True, max_retries=3)
def transcribe_part(self, session_id: str, part_index: int) -> str:
    try:
        note_id = asyncio.run(process_part(session_id, part_index))
    except TranscriptionRateLimited as exc:
        rate_count = asyncio.run(_mark_rate_limited(session_id, part_index))
        if self.request.retries >= self.max_retries:
            asyncio.run(_mark_failed(session_id, part_index, "rate_limited"))
            return "rate_limited"
        if rate_count >= 3:
            logger.warning("Gemini rate limit persisted for recording session %s.", session_id)
        raise self.retry(exc=exc, countdown=exc.retry_after, max_retries=self.max_retries)
    except Exception as exc:
        logger.warning(
            "Transcription attempt %s failed for recording part %s (%s).",
            self.request.retries + 1,
            part_index,
            type(exc).__name__,
        )
        current_attempt = self.request.retries + 1
        if current_attempt >= 3:
            note_id = asyncio.run(_mark_failed(session_id, part_index, type(exc).__name__))
            if note_id:
                try:
                    celery_app.send_task("indexing.index_note", args=[note_id])
                except Exception:
                    logger.exception("Could not dispatch indexing for finished recording note %s.", note_id)
            return "failed"
        asyncio.run(_reset_part_for_retry(session_id, part_index))
        raise self.retry(exc=exc, countdown=30 * (2**self.request.retries), max_retries=self.max_retries)

    if note_id:
        try:
            celery_app.send_task("indexing.index_note", args=[note_id])
        except Exception:
            logger.exception("Could not dispatch indexing for finished recording note %s.", note_id)
    return "done"


async def _reset_part_for_retry(session_id: str, part_index: int) -> None:
    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await db.execute(
                select(RecordingPart).where(
                    RecordingPart.session_id == uuid.UUID(session_id),
                    RecordingPart.part_index == part_index,
                )
            )
            part = result.scalar_one()
            part.status = "queued"
            part.error_code = None


__all__ = ["transcribe_part"]
