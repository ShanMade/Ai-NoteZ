from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.errors import NoteNotFound
from ...models import Note, RecordingPart, RecordingSession, SessionSpeaker, TranscriptSegment
from ...repositories.notes import update_note


async def build_transcript(db: AsyncSession, session_id: uuid.UUID) -> str:
    rows = await db.execute(
        select(TranscriptSegment, SessionSpeaker)
        .outerjoin(SessionSpeaker, TranscriptSegment.speaker_id == SessionSpeaker.id)
        .where(TranscriptSegment.session_id == session_id, TranscriptSegment.text != "")
        .order_by(TranscriptSegment.part_index, TranscriptSegment.start_ms, TranscriptSegment.id)
    )
    lines = []
    for segment, speaker in rows:
        prefix = speaker.display_name if speaker else "Speaker"
        if speaker and speaker.role:
            prefix = f"{prefix} ({speaker.role})"
        lines.append(f"{prefix}: {segment.text}")
    return "\n\n".join(lines)


async def finalize_if_ready(db: AsyncSession, session: RecordingSession) -> str | None:
    if not session.finish_requested:
        return None
    result = await db.execute(
        select(RecordingPart.status).where(RecordingPart.session_id == session.id)
    )
    statuses = list(result.scalars().all())
    if any(status == "failed" for status in statuses):
        session.status = "has_failed_parts"
        return None
    if any(status in {"queued", "processing"} for status in statuses):
        session.status = "processing"
        return None
    if len(statuses) < session.expected_part_count:
        session.status = "processing"
        return None
    if session.status == "done":
        return None

    note = await db.get(Note, session.note_id)
    if note is None or note.user_id != session.user_id or note.deleted_at is not None:
        raise NoteNotFound()
    await update_note(
        db,
        user_id=session.user_id,
        note_id=note.id,
        expected_version=note.version,
        fields={"body": await build_transcript(db, session.id)},
    )
    session.status = "done"
    session.consecutive_rate_limits = 0
    return str(note.id)
