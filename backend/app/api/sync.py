from __future__ import annotations

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import get_db
from ..core.errors import NoteNotFound, VersionConflict
from ..models import Note
from ..repositories import notes as repository
from ..schemas.note import NoteCreate, NoteRead
from ..schemas.sync import (
    SyncBatchRequest,
    SyncBatchResponse,
    SyncBatchResult,
    SyncDeltaResponse,
    SyncNoteRead,
    SyncOperation,
)
from .deps import RateLimitedUser

router = APIRouter(prefix="/v1/sync", tags=["sync"])


@router.get("/delta", response_model=SyncDeltaResponse)
async def sync_delta(
    user: RateLimitedUser,
    since: datetime = Query(),
    db: AsyncSession = Depends(get_db),
) -> SyncDeltaResponse:
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    items = await repository.list_delta(db, user_id=user.id, since=since)
    return SyncDeltaResponse(
        items=[
            SyncNoteRead.model_validate(
                {
                    **NoteRead.model_validate(note).model_dump(),
                    "deleted": note.deleted_at is not None,
                }
            )
            for note in items
        ],
        next_since=max((item.updated_at for item in items), default=None),
    )


async def _apply_operation(
    db: AsyncSession,
    *,
    user_id: str,
    operation: SyncOperation,
) -> SyncBatchResult:
    if operation.op == "create":
        payload = NoteCreate.model_validate(operation.fields)
        async with db.begin():
            note = await repository.create_note(
                db,
                user_id=user_id,
                fields=payload.model_dump(),
            )
        return SyncBatchResult(
            client_id=operation.client_id,
            status="ok",
            note=NoteRead.model_validate(note),
        )

    if operation.note_id is None:
        raise HTTPException(status_code=422, detail=f"{operation.op} operations require note_id.")
    if operation.version is None:
        raise HTTPException(status_code=422, detail=f"{operation.op} operations require version.")

    async with db.begin():
        if operation.op == "patch":
            payload = NoteCreate.model_validate(operation.fields)
            fields = payload.model_dump(exclude_unset=True)
            if not fields:
                raise HTTPException(status_code=422, detail="Patch operations require at least one field.")
            note = await repository.update_note(
                db,
                user_id=user_id,
                note_id=operation.note_id,
                expected_version=operation.version,
                fields=fields,
            )
        else:
            note = await repository.delete_note(
                db,
                user_id=user_id,
                note_id=operation.note_id,
                expected_version=operation.version,
            )
    return SyncBatchResult(
        client_id=operation.client_id,
        status="ok",
        note=NoteRead.model_validate(note),
    )


@router.post("/batch", response_model=SyncBatchResponse)
async def sync_batch(
    payload: SyncBatchRequest,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> SyncBatchResponse:
    results: list[SyncBatchResult] = []
    for operation in payload.ops:
        try:
            results.append(await _apply_operation(db, user_id=user.id, operation=operation))
        except VersionConflict as exc:
            await db.rollback()
            results.append(
                SyncBatchResult(
                    client_id=operation.client_id,
                    status="conflict",
                    current_version=exc.current_version,
                )
            )
        except NoteNotFound:
            await db.rollback()
            results.append(SyncBatchResult(client_id=operation.client_id, status="not_found"))
    return SyncBatchResponse(results=results)
