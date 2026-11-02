from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.db import get_db
from ..core.errors import NoteNotFound
from ..models import Note
from ..repositories import notes as repository
from ..schemas.common import Page
from ..schemas.note import FacetCreate, FacetRead, NoteCreate, NotePatch, NoteRead, SharedNoteRead
from .deps import RateLimitedUser

router = APIRouter(prefix="/v1/notes", tags=["notes"])


def _encode_cursor(note: Note) -> str:
    payload = json.dumps([note.updated_at.isoformat(), str(note.id)], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        value = json.loads(raw)
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError
        if not isinstance(value[0], str) or not isinstance(value[1], str):
            raise ValueError
        timestamp = datetime.fromisoformat(value[0])
        return timestamp, uuid.UUID(value[1])
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="Invalid notes cursor.") from exc


@router.get("/shared/{token}", response_model=SharedNoteRead)
async def get_shared_note(token: str, db: AsyncSession = Depends(get_db)) -> Note:
    note = await repository.get_shared_note(db, token=token)
    if note is None:
        raise NoteNotFound()
    return note


@router.get("", response_model=Page[NoteRead])
async def get_notes(
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
    folder: str | None = Query(default=None, max_length=2000),
    kind: str | None = Query(default=None, max_length=80),
    updated_after: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=512),
) -> Page[NoteRead]:
    items = await repository.list_notes(
        db,
        user_id=user.id,
        folder=folder,
        kind=kind,
        updated_after=updated_after,
        after=_decode_cursor(cursor),
        limit=limit + 1,
    )
    has_more = len(items) > limit
    items = items[:limit]
    return Page(
        items=[NoteRead.model_validate(note) for note in items],
        next_cursor=_encode_cursor(items[-1]) if has_more and items else None,
    )


@router.post("", response_model=NoteRead)
async def create_note(
    payload: NoteCreate,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> Note:
    async with db.begin():
        return await repository.create_note(db, user_id=user.id, fields=payload.model_dump())


@router.get("/{note_id}", response_model=NoteRead)
async def get_note(
    note_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> Note:
    note = await repository.get_note(db, user_id=user.id, note_id=note_id)
    if note is None:
        raise NoteNotFound()
    return note


@router.patch("/{note_id}", response_model=NoteRead)
async def patch_note(
    note_id: uuid.UUID,
    payload: NotePatch,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> Note:
    fields = payload.model_dump(exclude={"version"}, exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=422, detail="Provide at least one note field to update.")
    async with db.begin():
        return await repository.update_note(
            db,
            user_id=user.id,
            note_id=note_id,
            expected_version=payload.version,
            fields=fields,
        )


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_note(
    note_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    async with db.begin():
        await repository.delete_note(db, user_id=user.id, note_id=note_id)


@router.get("/{note_id}/children", response_model=list[NoteRead])
async def get_note_children(
    note_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> list[Note]:
    return await repository.list_children(db, user_id=user.id, note_id=note_id)


@router.post("/{note_id}/share")
async def share_note(
    note_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    async with db.begin():
        note = await repository.share_note(db, user_id=user.id, note_id=note_id)
    return {
        "shared_token": note.shared_token or "",
        "url": f"{settings.public_frontend_url}/share/{note.shared_token}",
    }


@router.post("/{note_id}/facets", response_model=FacetRead)
async def create_note_facet(
    note_id: uuid.UUID,
    payload: FacetCreate,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
):
    async with db.begin():
        facet = await repository.add_facet(
            db,
            user_id=user.id,
            note_id=note_id,
            name=payload.name,
            value=payload.value,
        )
    return facet
