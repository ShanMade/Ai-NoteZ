from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RecordingSessionCreate(BaseModel):
    note_id: uuid.UUID
    context_prompt: str | None = Field(default=None, max_length=4000)


class RecordingSessionCreated(BaseModel):
    session_id: uuid.UUID


class TranscriptSegmentRead(BaseModel):
    id: uuid.UUID
    part_index: int
    speaker_id: uuid.UUID | None
    raw_gemini_label: str | None
    display_name: str | None
    role: str | None
    text: str
    start_ms: int
    end_ms: int


class RecordingPartRead(BaseModel):
    part_index: int
    status: Literal["queued", "processing", "done", "failed"]
    is_empty: bool
    attempts: int
    segments: list[TranscriptSegmentRead] = Field(default_factory=list)


class SpeakerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    gemini_label: str
    display_name: str
    role: str | None
    sample_text: str
    first_seen_part: int
    user_confirmed: bool


class SpeakerPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    role: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def require_a_change(self) -> SpeakerPatch:
        if self.display_name is None and self.role is None:
            raise ValueError("Provide a display_name or role.")
        return self


class RecordingFinishResponse(BaseModel):
    status: Literal["processing", "done", "has_failed_parts"]


class RecordingFinishRequest(BaseModel):
    expected_part_count: int = Field(default=0, ge=0, le=50001)


class RecordingPartQueued(BaseModel):
    part_id: uuid.UUID
    status: Literal["queued", "processing", "done", "failed"]


class RecordingSessionRead(BaseModel):
    session_id: uuid.UUID
    note_id: uuid.UUID
    status: Literal["recording", "processing", "done", "has_failed_parts", "rate_limited"]
    context_prompt: str | None
    finish_requested: bool
    expected_part_count: int
    consecutive_rate_limits: int


class RecordingUploadUrl(BaseModel):
    upload_url: str
    method: Literal["PUT"] = "PUT"
    expires_in: int
