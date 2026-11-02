from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKey


class SessionSpeaker(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "session_speakers"
    __table_args__ = (Index("ix_session_speakers_session_first_seen", "session_id", "first_seen_part"),)

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recording_sessions.id", ondelete="CASCADE"), nullable=False
    )
    gemini_label: Mapped[str] = mapped_column(String(160), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str | None] = mapped_column(String(80))
    sample_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    first_seen_part: Mapped[int] = mapped_column(Integer, nullable=False)
    user_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    session: Mapped[RecordingSession] = relationship(back_populates="speakers")
