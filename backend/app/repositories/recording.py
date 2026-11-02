from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Note, RecordingPart, RecordingSession, SessionSpeaker, TranscriptSegment


async def get_session(
    db: AsyncSession,
    *,
    user_id: str,
    session_id: uuid.UUID,
) -> RecordingSession | None:
    result = await db.execute(
        select(RecordingSession).where(
            RecordingSession.id == session_id,
            RecordingSession.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_part(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    part_index: int,
) -> RecordingPart | None:
    result = await db.execute(
        select(RecordingPart).where(
            RecordingPart.session_id == session_id,
            RecordingPart.part_index == part_index,
        )
    )
    return result.scalar_one_or_none()


async def list_speakers(db: AsyncSession, *, session_id: uuid.UUID) -> list[SessionSpeaker]:
    result = await db.execute(
        select(SessionSpeaker)
        .where(SessionSpeaker.session_id == session_id)
        .order_by(SessionSpeaker.first_seen_part, SessionSpeaker.created_at, SessionSpeaker.id)
    )
    return list(result.scalars().all())


async def list_transcript(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    part_index: int | None = None,
) -> list[TranscriptSegment]:
    query = select(TranscriptSegment).where(TranscriptSegment.session_id == session_id)
    if part_index is not None:
        query = query.where(TranscriptSegment.part_index == part_index)
    result = await db.execute(
        query.order_by(TranscriptSegment.part_index, TranscriptSegment.start_ms, TranscriptSegment.id)
    )
    return list(result.scalars().all())


async def get_owned_recording_note(
    db: AsyncSession,
    *,
    user_id: str,
    note_id: uuid.UUID,
) -> Note | None:
    result = await db.execute(
        select(Note).where(
            Note.id == note_id,
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()
