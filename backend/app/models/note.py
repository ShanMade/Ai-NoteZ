from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKey


class Note(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_user_id", "user_id"),
        Index("ix_notes_user_folder_path", "user_id", "folder_path"),
        Index("ix_notes_user_updated_at", "user_id", "updated_at"),
        Index("ix_notes_user_deleted_at", "user_id", "deleted_at"),
        Index("ix_notes_search_vec", "search_vec", postgresql_using="gin"),
        UniqueConstraint("shared_token", name="uq_notes_shared_token"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    kind: Mapped[str] = mapped_column(String(80), nullable=False, default="note", server_default="note")
    note_type: Mapped[str | None] = mapped_column(String(80))
    folder_path: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("notes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    shared_token: Mapped[str | None] = mapped_column(String(64))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    search_vec: Mapped[Any] = mapped_column(
        TSVECTOR().with_variant(Text(), "sqlite"),
        Computed(
            "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))",
            persisted=True,
        ),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="notes")
    parent: Mapped[Note | None] = relationship(
        remote_side="Note.id",
        back_populates="children",
        passive_deletes=True,
    )
    children: Mapped[list[Note]] = relationship(back_populates="parent", passive_deletes=True)
    facets: Mapped[list[NoteFacet]] = relationship(back_populates="note", cascade="all, delete-orphan")


class NoteFacet(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "note_facets"
    __table_args__ = (
        Index("ix_note_facets_user_note", "user_id", "note_id"),
        Index("ix_note_facets_user_name", "user_id", "name"),
    )

    note_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    facet_type: Mapped[str] = mapped_column(String(40), nullable=False, default="attribute", server_default="attribute")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="user", server_default="user")
    user_edited: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    note: Mapped[Note] = relationship(back_populates="facets")
