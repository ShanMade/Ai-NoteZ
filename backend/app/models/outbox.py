from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDPrimaryKey, TimestampMixin


class Outbox(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "outbox"
    __table_args__ = (
        CheckConstraint("event IN ('upsert', 'delete', 'facet_extract')", name="ck_outbox_event"),
        CheckConstraint("status IN ('pending', 'processing', 'done', 'failed')", name="ck_outbox_status"),
        Index(
            "ux_outbox_pending",
            "note_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index("ix_outbox_status_next_attempt", "status", "next_attempt_at"),
    )

    note_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    event: Mapped[Literal["upsert", "delete", "facet_extract"]] = mapped_column(String(32), nullable=False)
    status: Mapped[Literal["pending", "processing", "done", "failed"]] = mapped_column(
        String(24), nullable=False, default="pending", server_default="pending"
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_error: Mapped[str | None] = mapped_column(Text)
