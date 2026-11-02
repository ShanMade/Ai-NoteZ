from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=2_000_000)
    kind: str = Field(default="note", min_length=1, max_length=80)
    folder_path: str = Field(default="", max_length=2000)
    parent_id: uuid.UUID | None = None
    note_type: str | None = Field(default=None, max_length=80)


class NotePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)
    title: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=2_000_000)
    kind: str = Field(default="note", min_length=1, max_length=80)
    folder_path: str = Field(default="", max_length=2000)
    parent_id: uuid.UUID | None = None
    note_type: str | None = Field(default=None, max_length=80)


class NoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    body: str
    kind: str
    folder_path: str
    parent_id: uuid.UUID | None
    note_type: str | None
    version: int
    shared_token: str | None
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SharedNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    body: str
    kind: str
    folder_path: str
    created_at: datetime
    updated_at: datetime
    version: int


class FacetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=4000)


class FacetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    note_id: uuid.UUID
    facet_type: str
    name: str
    value: str
    source: str
    user_edited: bool
    created_at: datetime
    updated_at: datetime
