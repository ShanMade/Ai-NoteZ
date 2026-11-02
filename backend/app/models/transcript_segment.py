from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKey


class TranscriptSegment(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "transcript_segments"
    __table_args__ = (Index("ix_transcript_segments_session_part_start", "session_id", "part_index", "start_ms"),)

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recording_sessions.id", ondelete="CASCADE"), nullable=False
    )
    part_index: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("session_speakers.id", ondelete="SET NULL"), nullable=True
    )
    raw_gemini_label: Mapped[str | None] = mapped_column(String(160))
    text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    session: Mapped[RecordingSession] = relationship(back_populates="segments")
    speaker: Mapped[SessionSpeaker | None] = relationship()
