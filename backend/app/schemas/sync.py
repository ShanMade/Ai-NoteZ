from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .note import NoteCreate, NoteRead


class SyncNoteRead(NoteRead):
    deleted: bool


class SyncOperation(BaseModel):
    model_config = {"extra": "forbid"}

    op: Literal["create", "patch", "delete"]
    client_id: str = Field(min_length=1, max_length=160)
    note_id: uuid.UUID | None = None
    version: int | None = Field(default=None, ge=1)
    fields: dict[str, object] = Field(default_factory=dict)


class SyncBatchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    ops: list[SyncOperation] = Field(max_length=100)


class SyncBatchResult(BaseModel):
    client_id: str
    status: Literal["ok", "conflict", "not_found"]
    note: NoteRead | None = None
    current_version: int | None = None


class SyncBatchResponse(BaseModel):
    results: list[SyncBatchResult]


class SyncDeltaResponse(BaseModel):
    items: list[SyncNoteRead]
    next_since: datetime | None = None


class SyncCreateFields(NoteCreate):
    pass
