from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import get_db
from ..models import Note
from ..repositories import notes as repository
from ..schemas.note import NoteRead
from .deps import RateLimitedUser

router = APIRouter(prefix="/v1/account", tags=["account"])


@router.get("/export")
async def export_account(
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    notes: list[Note] = await repository.export_user_notes(db, user_id=user.id)
    return {
        "format": "notez-export-v1",
        "user": {"id": user.id},
        "notes": jsonable_encoder([NoteRead.model_validate(note) for note in notes]),
    }
