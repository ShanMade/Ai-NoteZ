from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from .base import Base, UUIDPrimaryKey


class ChatHistory(UUIDPrimaryKey, Base):
    __tablename__ = "chat_history"
    __table_args__ = (
        UniqueConstraint("conversation_id", "message_index", name="uq_chat_history_conversation_index"),
        Index("ix_chat_history_user_conversation", "user_id", "conversation_id", "message_index"),
        Index("ix_chat_history_created_at", "created_at"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    message_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[Literal["user", "assistant"]] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    note_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notes.id", ondelete="SET NULL"))
    citations: Mapped[list[dict[str, str]]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default=list,
        server_default="[]",
    )
    is_clarification: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
