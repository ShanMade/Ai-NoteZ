from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=12_000)
    note_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None


class ChatSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=12_000)
    limit: int = Field(default=8, ge=1, le=20)


class NoteFromAnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: uuid.UUID
    message_index: int = Field(ge=0)
    folder_path: str = Field(default="", max_length=2000)


class ChatCitation(BaseModel):
    note_id: uuid.UUID
    title: str


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    conversation_id: uuid.UUID
    message_index: int
    role: str
    content: str
    note_id: uuid.UUID | None
    citations: list[ChatCitation]
    is_clarification: bool


class ChatHistoryRead(BaseModel):
    conversation_id: uuid.UUID
    messages: list[ChatMessageRead]


class SearchExcerptRead(BaseModel):
    note_id: uuid.UUID
    title: str
    text: str
    score: float


class ChatSearchRead(BaseModel):
    confident: bool
    excerpts: list[SearchExcerptRead]
