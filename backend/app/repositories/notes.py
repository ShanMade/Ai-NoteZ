from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.errors import InvalidNoteHierarchy, NoteNotFound, VersionConflict
from ..models import Note, NoteFacet, Outbox


async def write_outbox(
    db: AsyncSession,
    *,
    note_id: uuid.UUID,
    event: str,
) -> None:
    values = {"note_id": note_id, "event": event, "status": "pending", "attempts": 0}
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = pg_insert(Outbox).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[Outbox.note_id],
            index_where=text("status = 'pending'"),
            set_={
                "event": statement.excluded.event,
                "attempts": 0,
                "next_attempt_at": func.now(),
                "last_error": None,
                "updated_at": func.now(),
            },
        )
    elif dialect == "sqlite":
        statement = sqlite_insert(Outbox).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[Outbox.note_id],
            index_where=text("status = 'pending'"),
            set_={
                "event": statement.excluded.event,
                "attempts": 0,
                "next_attempt_at": func.now(),
                "last_error": None,
                "updated_at": func.now(),
            },
        )
    else:
        raise RuntimeError(f"Outbox upsert is not configured for database dialect {dialect!r}.")
    await db.execute(statement)


async def get_note(
    db: AsyncSession,
    *,
    user_id: str,
    note_id: uuid.UUID,
    include_deleted: bool = False,
) -> Note | None:
    query = select(Note).where(Note.id == note_id, Note.user_id == user_id)
    if not include_deleted:
        query = query.where(Note.deleted_at.is_(None))
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def list_notes(
    db: AsyncSession,
    *,
    user_id: str,
    folder: str | None = None,
    kind: str | None = None,
    updated_after: datetime | None = None,
    after: tuple[datetime, uuid.UUID] | None = None,
    limit: int = 50,
) -> list[Note]:
    query = select(Note).where(Note.user_id == user_id, Note.deleted_at.is_(None))
    if folder:
        query = query.where(Note.folder_path.startswith(folder, autoescape=True))
    if kind:
        query = query.where(Note.kind == kind)
    if updated_after:
        query = query.where(Note.updated_at > updated_after)
    if after:
        cursor_time, cursor_id = after
        query = query.where(
            or_(
                Note.updated_at > cursor_time,
                and_(Note.updated_at == cursor_time, Note.id > cursor_id),
            )
        )
    query = query.order_by(Note.updated_at, Note.id).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_note(
    db: AsyncSession,
    *,
    user_id: str,
    fields: dict[str, Any],
) -> Note:
    parent_id = fields.get("parent_id")
    if parent_id is not None:
        parent = await get_note(db, user_id=user_id, note_id=parent_id)
        if parent is None:
            raise NoteNotFound()
        depth = 1
        while parent.parent_id is not None:
            parent = await get_note(db, user_id=user_id, note_id=parent.parent_id)
            if parent is None:
                raise NoteNotFound()
            depth += 1
            if depth >= 5:
                raise InvalidNoteHierarchy("Sub-notes cannot be nested more than five levels deep.")
    note = Note(user_id=user_id, **fields)
    db.add(note)
    await db.flush()
    await write_outbox(db, note_id=note.id, event="upsert")
    await db.flush()
    return note


def _note_snapshot(note: Note) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "title": note.title,
        "body": note.body,
        "kind": note.kind,
        "folder_path": note.folder_path,
        "parent_id": str(note.parent_id) if note.parent_id else None,
        "note_type": note.note_type,
        "version": note.version,
        "shared_token": note.shared_token,
        "deleted_at": note.deleted_at.isoformat() if note.deleted_at else None,
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "updated_at": note.updated_at.isoformat() if note.updated_at else None,
    }


async def update_note(
    db: AsyncSession,
    *,
    user_id: str,
    note_id: uuid.UUID,
    expected_version: int,
    fields: dict[str, Any],
) -> Note:
    current = await get_note(db, user_id=user_id, note_id=note_id)
    if current is None:
        raise NoteNotFound()
    if current.version != expected_version:
        raise VersionConflict(current_version=current.version, current=_note_snapshot(current))

    parent_id = fields.get("parent_id")
    if parent_id is not None:
        parent = await get_note(db, user_id=user_id, note_id=parent_id)
        if parent is None:
            raise NoteNotFound()
        depth = 1
        while True:
            if parent.id == note_id:
                raise InvalidNoteHierarchy("A note cannot be nested under one of its descendants.")
            if parent.parent_id is None:
                break
            parent = await get_note(db, user_id=user_id, note_id=parent.parent_id)
            if parent is None:
                raise NoteNotFound()
            depth += 1
            if depth >= 5:
                raise InvalidNoteHierarchy("Sub-notes cannot be nested more than five levels deep.")

    result = await db.execute(
        update(Note)
        .where(
            Note.id == note_id,
            Note.user_id == user_id,
            Note.version == expected_version,
            Note.deleted_at.is_(None),
        )
        .values(**fields, version=Note.version + 1, updated_at=func.now())
        .returning(Note)
    )
    updated = result.scalar_one_or_none()
    if updated is None:
        current = await get_note(db, user_id=user_id, note_id=note_id)
        if current is None:
            raise NoteNotFound()
        raise VersionConflict(current_version=current.version, current=_note_snapshot(current))
    await write_outbox(db, note_id=note_id, event="upsert")
    await db.flush()
    return updated


async def delete_note(
    db: AsyncSession,
    *,
    user_id: str,
    note_id: uuid.UUID,
    expected_version: int | None = None,
) -> Note:
    note = await get_note(db, user_id=user_id, note_id=note_id)
    if note is None:
        raise NoteNotFound()
    if expected_version is not None and note.version != expected_version:
        raise VersionConflict(current_version=note.version, current=_note_snapshot(note))

    children_result = await db.execute(
        select(Note).where(
            Note.parent_id == note_id,
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
        )
    )
    children = list(children_result.scalars().all())
    # TODO: decide cascade policy with product.
    for child in children:
        child.parent_id = None
        child.folder_path = note.folder_path
        child.version += 1
        child.updated_at = datetime.now(timezone.utc)
        await write_outbox(db, note_id=child.id, event="upsert")

    result = await db.execute(
        update(Note)
        .where(
            Note.id == note_id,
            Note.user_id == user_id,
            Note.version == note.version,
            Note.deleted_at.is_(None),
        )
        .values(deleted_at=func.now(), version=Note.version + 1, updated_at=func.now())
        .returning(Note)
    )
    deleted = result.scalar_one_or_none()
    if deleted is None:
        current = await get_note(db, user_id=user_id, note_id=note_id)
        if current is None:
            raise NoteNotFound()
        raise VersionConflict(current_version=current.version, current=_note_snapshot(current))
    await write_outbox(db, note_id=note_id, event="delete")
    await db.flush()
    return deleted


async def list_children(db: AsyncSession, *, user_id: str, note_id: uuid.UUID) -> list[Note]:
    if await get_note(db, user_id=user_id, note_id=note_id) is None:
        raise NoteNotFound()
    result = await db.execute(
        select(Note)
        .where(
            Note.parent_id == note_id,
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
        )
        .order_by(Note.created_at, Note.id)
    )
    return list(result.scalars().all())


async def get_shared_note(db: AsyncSession, *, token: str) -> Note | None:
    result = await db.execute(
        select(Note).where(Note.shared_token == token, Note.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def share_note(db: AsyncSession, *, user_id: str, note_id: uuid.UUID) -> Note:
    note = await get_note(db, user_id=user_id, note_id=note_id)
    if note is None:
        raise NoteNotFound()
    if note.shared_token is None:
        note.shared_token = secrets.token_urlsafe(32)
        note.version += 1
        note.updated_at = datetime.now(timezone.utc)
        await write_outbox(db, note_id=note.id, event="upsert")
        await db.flush()
    return note


async def add_facet(
    db: AsyncSession,
    *,
    user_id: str,
    note_id: uuid.UUID,
    name: str,
    value: str,
) -> NoteFacet:
    if await get_note(db, user_id=user_id, note_id=note_id) is None:
        raise NoteNotFound()
    facet = NoteFacet(
        note_id=note_id,
        user_id=user_id,
        facet_type="attribute",
        name=name.strip(),
        value=value.strip(),
        source="user",
        user_edited=True,
    )
    db.add(facet)
    await db.flush()
    await write_outbox(db, note_id=note_id, event="facet_extract")
    await db.flush()
    return facet


async def list_delta(
    db: AsyncSession,
    *,
    user_id: str,
    since: datetime,
) -> list[Note]:
    result = await db.execute(
        select(Note)
        .where(Note.user_id == user_id, Note.updated_at > since)
        .order_by(Note.updated_at, Note.id)
    )
    return list(result.scalars().all())


async def export_user_notes(db: AsyncSession, *, user_id: str) -> list[Note]:
    result = await db.execute(
        select(Note).where(Note.user_id == user_id).order_by(Note.created_at, Note.id)
    )
    return list(result.scalars().all())
