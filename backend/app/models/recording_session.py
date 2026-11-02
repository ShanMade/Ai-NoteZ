from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKey


class RecordingSession(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "recording_sessions"
    __table_args__ = (
        Index("ix_recording_sessions_user_status", "user_id", "status"),
        Index("ix_recording_sessions_note_id", "note_id"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    note_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    context_prompt: Mapped[str | None] = mapped_column(Text)
    status: Mapped[Literal["recording", "processing", "done", "has_failed_parts", "rate_limited"]] = mapped_column(
        String(32), nullable=False, default="recording", server_default="recording"
    )
    finish_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    expected_part_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    consecutive_rate_limits: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    parts: Mapped[list[RecordingPart]] = relationship(back_populates="session", cascade="all, delete-orphan")
    speakers: Mapped[list[SessionSpeaker]] = relationship(back_populates="session", cascade="all, delete-orphan")
    segments: Mapped[list[TranscriptSegment]] = relationship(back_populates="session", cascade="all, delete-orphan")


class RecordingPart(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "recording_parts"
    __table_args__ = (
        UniqueConstraint("session_id", "part_index", name="uq_recording_parts_session_index"),
        Index("ix_recording_parts_status", "status"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recording_sessions.id", ondelete="CASCADE"), nullable=False
    )
    part_index: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[Literal["queued", "processing", "done", "failed"]] = mapped_column(
        String(24), nullable=False, default="queued", server_default="queued"
    )
    is_empty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error_code: Mapped[str | None] = mapped_column(String(64))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    session: Mapped[RecordingSession] = relationship(back_populates="parts")
