from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.celery_app import celery_app
from ..core.config import settings
from ..core.db import AsyncSessionLocal, get_db
from ..core.errors import NoteNotFound
from ..models import RecordingPart, RecordingSession, SessionSpeaker, TranscriptSegment
from ..repositories.recording import (
    get_owned_recording_note,
    get_part,
    get_session,
    list_speakers,
    list_transcript,
)
from ..schemas.recording import (
    RecordingFinishResponse,
    RecordingFinishRequest,
    RecordingPartQueued,
    RecordingPartRead,
    RecordingSessionCreate,
    RecordingSessionCreated,
    RecordingSessionRead,
    RecordingUploadUrl,
    SpeakerPatch,
    SpeakerRead,
    TranscriptSegmentRead,
)
from ..services.recording import storage
from ..services.recording.completion import finalize_if_ready
from .deps import RateLimitedUser

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/record", tags=["recording"])
_MAX_UPLOAD_BYTES = settings.max_part_size_mb * 1024 * 1024


def _segment_read(segment: TranscriptSegment, speaker: SessionSpeaker | None) -> TranscriptSegmentRead:
    return TranscriptSegmentRead(
        id=segment.id,
        part_index=segment.part_index,
        speaker_id=segment.speaker_id,
        raw_gemini_label=segment.raw_gemini_label,
        display_name=speaker.display_name if speaker else None,
        role=speaker.role if speaker else None,
        text=segment.text,
        start_ms=segment.start_ms,
        end_ms=segment.end_ms,
    )


async def _dispatch_part(session_id: uuid.UUID, part_index: int) -> None:
    try:
        await asyncio.to_thread(
            celery_app.send_task,
            "transcription.transcribe_part",
            args=[str(session_id), part_index],
        )
    except Exception as exc:
        logger.exception("Could not dispatch transcription for recording part %s.", part_index)
        async with AsyncSessionLocal() as db:
            async with db.begin():
                part = await get_part(db, session_id=session_id, part_index=part_index)
                if part is not None and part.status == "queued":
                    part.status = "failed"
                    part.error_code = "dispatch_failed"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transcription could not be queued. Retry this recording part.",
        ) from exc


@router.post("/sessions", response_model=RecordingSessionCreated, status_code=status.HTTP_201_CREATED)
async def create_recording_session(
    payload: RecordingSessionCreate,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> RecordingSessionCreated:
    note = await get_owned_recording_note(db, user_id=user.id, note_id=payload.note_id)
    if note is None or note.kind != "recording":
        raise NoteNotFound()
    session = RecordingSession(
        user_id=user.id,
        note_id=note.id,
        context_prompt=payload.context_prompt,
        status="recording",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return RecordingSessionCreated(session_id=session.id)


@router.get("/sessions/{session_id}", response_model=RecordingSessionRead)
async def get_recording_session(
    session_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> RecordingSessionRead:
    session = await get_session(db, user_id=user.id, session_id=session_id)
    if session is None:
        raise NoteNotFound()
    return RecordingSessionRead(
        session_id=session.id,
        note_id=session.note_id,
        status=session.status,
        context_prompt=session.context_prompt,
        finish_requested=session.finish_requested,
        expected_part_count=session.expected_part_count,
        consecutive_rate_limits=session.consecutive_rate_limits,
    )


@router.post(
    "/sessions/{session_id}/parts",
    response_model=RecordingPartQueued,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_recording_part(
    session_id: uuid.UUID,
    user: RateLimitedUser,
    audio: UploadFile = File(...),
    part_index: int = Form(..., ge=0, le=50000),
    is_empty: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
) -> RecordingPartQueued:
    session = await get_session(db, user_id=user.id, session_id=session_id)
    if session is None:
        raise NoteNotFound()
    if session.status in {"done", "has_failed_parts"}:
        raise HTTPException(status_code=409, detail="This recording session is already finished.")
    if session.finish_requested and part_index >= session.expected_part_count:
        raise HTTPException(status_code=409, detail="This recording part was not included when the session was finished.")
    existing = await get_part(db, session_id=session_id, part_index=part_index)
    if existing is not None:
        return RecordingPartQueued(part_id=existing.id, status=existing.status)

    content_type = audio.content_type or "application/octet-stream"
    if not content_type.startswith("audio/") and content_type != "application/octet-stream":
        raise HTTPException(status_code=415, detail="The recording part must be an audio file.")
    contents = await audio.read(_MAX_UPLOAD_BYTES + 1)
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Recording parts must be no larger than {settings.max_part_size_mb} MB.",
        )
    if not contents:
        raise HTTPException(status_code=422, detail="The audio part is empty.")

    storage_key = f"recordings/{session_id}/{part_index}-{uuid.uuid4().hex}.audio"
    if is_empty:
        storage_key = f"empty/{session_id}/{part_index}"
    else:
        try:
            storage_key = await asyncio.to_thread(storage.store_audio, storage_key, contents, content_type)
        except Exception as exc:
            logger.exception("Could not persist uploaded audio for recording part %s.", part_index)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Recording audio could not be stored. Retry the upload.",
            ) from exc

    part = RecordingPart(
        session_id=session_id,
        part_index=part_index,
        storage_key=storage_key,
        content_type=content_type,
        status="done" if is_empty else "queued",
        is_empty=is_empty,
    )
    db.add(part)
    await db.flush()
    if is_empty:
        db.add(
            TranscriptSegment(
                session_id=session_id,
                part_index=part_index,
                text="",
                start_ms=0,
                end_ms=0,
            )
        )
    await db.commit()
    await db.refresh(part)
    if is_empty and session.finish_requested:
        async with db.begin():
            note_id = await finalize_if_ready(db, session)
        if note_id:
            try:
                await asyncio.to_thread(celery_app.send_task, "indexing.index_note", args=[note_id])
            except Exception:
                logger.exception("Could not dispatch indexing for finished recording note %s.", note_id)
    if not is_empty:
        await _dispatch_part(session_id, part_index)
    return RecordingPartQueued(part_id=part.id, status=part.status)


@router.get("/sessions/{session_id}/parts/{part_index}", response_model=RecordingPartRead)
async def get_recording_part(
    session_id: uuid.UUID,
    part_index: int,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> RecordingPartRead:
    session = await get_session(db, user_id=user.id, session_id=session_id)
    if session is None:
        raise NoteNotFound()
    part = await get_part(db, session_id=session_id, part_index=part_index)
    if part is None:
        raise NoteNotFound()
    rows = await db.execute(
        select(TranscriptSegment, SessionSpeaker)
        .outerjoin(SessionSpeaker, TranscriptSegment.speaker_id == SessionSpeaker.id)
        .where(
            TranscriptSegment.session_id == session_id,
            TranscriptSegment.part_index == part_index,
        )
        .order_by(TranscriptSegment.start_ms, TranscriptSegment.id)
    )
    return RecordingPartRead(
        part_index=part_index,
        status=part.status,
        is_empty=part.is_empty,
        attempts=part.attempts,
        segments=[_segment_read(segment, speaker) for segment, speaker in rows],
    )


@router.post("/sessions/{session_id}/parts/{part_index}/retry", response_model=RecordingPartQueued)
async def retry_recording_part(
    session_id: uuid.UUID,
    part_index: int,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> RecordingPartQueued:
    session = await get_session(db, user_id=user.id, session_id=session_id)
    if session is None:
        raise NoteNotFound()
    part = await get_part(db, session_id=session_id, part_index=part_index)
    if part is None:
        raise NoteNotFound()
    if part.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed recording parts can be retried.")
    part.status = "queued"
    part.attempts = 0
    part.error_code = None
    session.status = "processing" if session.finish_requested else "recording"
    await db.commit()
    await _dispatch_part(session_id, part_index)
    return RecordingPartQueued(part_id=part.id, status=part.status)


@router.get("/sessions/{session_id}/parts/{part_index}/upload-url", response_model=RecordingUploadUrl)
async def get_recording_upload_url(
    session_id: uuid.UUID,
    part_index: int,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> RecordingUploadUrl:
    session = await get_session(db, user_id=user.id, session_id=session_id)
    if session is None:
        raise NoteNotFound()
    part = await get_part(db, session_id=session_id, part_index=part_index)
    if part is None:
        raise NoteNotFound()
    if part.status != "failed" or part.attempts < 3:
        raise HTTPException(status_code=409, detail="An upload URL is available after three failed attempts.")
    try:
        signed_url = await asyncio.to_thread(storage.upload_url, part.storage_key)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="R2 storage is not configured for manual recording retries.",
        ) from exc
    except Exception as exc:
        logger.exception("Could not create a replacement upload URL for recording part %s.", part_index)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A replacement upload URL could not be created.",
        ) from exc
    return RecordingUploadUrl(upload_url=signed_url, expires_in=900)


@router.post("/sessions/{session_id}/finish", response_model=RecordingFinishResponse)
async def finish_recording_session(
    session_id: uuid.UUID,
    payload: RecordingFinishRequest,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> RecordingFinishResponse:
    async with db.begin():
        session = await get_session(db, user_id=user.id, session_id=session_id)
        if session is None:
            raise NoteNotFound()
        if session.status == "done" and payload.expected_part_count != session.expected_part_count:
            raise HTTPException(status_code=409, detail="This recording session is already finalized.")
        session.finish_requested = True
        session.expected_part_count = max(session.expected_part_count, payload.expected_part_count)
        note_id = await finalize_if_ready(db, session)
        current_status = session.status
    if note_id:
        try:
            await asyncio.to_thread(celery_app.send_task, "indexing.index_note", args=[note_id])
        except Exception:
            logger.exception("Outbox persistence succeeded but direct recording index dispatch failed for %s.", note_id)
    return RecordingFinishResponse(status=current_status)


@router.get("/sessions/{session_id}/speakers", response_model=list[SpeakerRead])
async def get_recording_speakers(
    session_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> list[SessionSpeaker]:
    if await get_session(db, user_id=user.id, session_id=session_id) is None:
        raise NoteNotFound()
    return await list_speakers(db, session_id=session_id)


@router.patch(
    "/sessions/{session_id}/speakers/{speaker_id}",
    response_model=SpeakerRead,
)
async def update_recording_speaker(
    session_id: uuid.UUID,
    speaker_id: uuid.UUID,
    payload: SpeakerPatch,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> SessionSpeaker:
    if await get_session(db, user_id=user.id, session_id=session_id) is None:
        raise NoteNotFound()
    result = await db.execute(
        select(SessionSpeaker).where(
            SessionSpeaker.id == speaker_id,
            SessionSpeaker.session_id == session_id,
        )
    )
    speaker = result.scalar_one_or_none()
    if speaker is None:
        raise NoteNotFound()
    if "display_name" in payload.model_fields_set:
        speaker.display_name = (payload.display_name or "").strip()
    if "role" in payload.model_fields_set:
        speaker.role = payload.role.strip() if payload.role else None
    speaker.user_confirmed = True
    await db.commit()
    await db.refresh(speaker)
    return speaker
