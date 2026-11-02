from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import uuid

from celery.signals import worker_ready
from sqlalchemy import select

from ..core.celery_app import celery_app
from ..core.db import AsyncSessionLocal
from ..models import Note, Outbox
from ..services.rag.chunking import chunk_text, has_indexable_content
from ..services.rag.embeddings import embed_documents
from ..services.rag.facet_extraction import extract_and_store_facets
from ..services.rag.qdrant_client import (
    delete_note_vectors,
    delete_stale_chunks,
    ensure_collections,
    upsert,
)

logger = logging.getLogger(__name__)
def stable_point_id(note_id: uuid.UUID | str, chunk_index: int) -> str:
    return str(uuid.uuid5(uuid.UUID(str(note_id)), str(chunk_index)))


@worker_ready.connect
def initialize_qdrant_collections(**_kwargs: object) -> None:
    ensure_collections()


async def _mark_outbox_done(db, note_id: uuid.UUID) -> None:
    rows = await db.execute(
        select(Outbox).where(Outbox.note_id == note_id, Outbox.status == "processing")
    )
    for row in rows.scalars():
        row.status = "done"
        row.last_error = None


async def _mark_outbox_failed(note_id: str, error: Exception) -> None:
    try:
        note_uuid = uuid.UUID(note_id)
    except ValueError:
        return
    async with AsyncSessionLocal() as db:
        async with db.begin():
            rows = await db.execute(
                select(Outbox).where(
                    Outbox.note_id == note_uuid,
                    Outbox.status == "processing",
                )
            )
            for row in rows.scalars():
                row.status = "failed"
                row.last_error = f"Indexing failed: {type(error).__name__}"[:1000]
                row.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                    seconds=min(3600, 2 ** min(row.attempts, 12))
                )


async def _index_note(note_id: str) -> None:
    note_uuid = uuid.UUID(note_id)
    async with AsyncSessionLocal() as db:
        note = await db.scalar(select(Note).where(Note.id == note_uuid))
        if note is None or note.deleted_at is not None or not has_indexable_content(note.title, note.body):
            await asyncio.to_thread(delete_note_vectors, note_id)
            if note is not None:
                await _mark_outbox_done(db, note_uuid)
                await db.commit()
            return

        chunks = chunk_text(note.body, note.title)
        if not chunks:
            await asyncio.to_thread(delete_note_vectors, note_id)
            await _mark_outbox_done(db, note_uuid)
            await db.commit()
            return
        vectors = await embed_documents([chunk.text for chunk in chunks])
        points = [
            {
                "id": stable_point_id(note.id, index),
                "vector": vector,
                "payload": {
                    "note_id": str(note.id),
                    "user_id": str(note.user_id),
                    "chunk_index": index,
                    "folder_path": note.folder_path,
                    "note_type": note.note_type,
                    "version": note.version,
                    "title": note.title,
                    "text": chunk.text,
                },
            }
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
        ]
        await asyncio.to_thread(upsert, "note_chunks", points)
        await asyncio.to_thread(delete_stale_chunks, note_id, len(chunks))
        await extract_and_store_facets(db, note)
        await _mark_outbox_done(db, note_uuid)
        await db.commit()


@celery_app.task(name="indexing.index_note")
def index_note(note_id: str) -> str:
    try:
        asyncio.run(_index_note(note_id))
    except Exception as exc:
        logger.exception("Could not index note %s.", note_id)
        asyncio.run(_mark_outbox_failed(note_id, exc))
        raise
    return note_id


@celery_app.task(name="indexing.delete_note")
def delete_note(note_id: str) -> str:
    try:
        asyncio.run(asyncio.to_thread(delete_note_vectors, note_id))
        try:
            note_uuid = uuid.UUID(note_id)
        except ValueError:
            return note_id
        async def mark_deleted() -> None:
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    await _mark_outbox_done(db, note_uuid)
        asyncio.run(mark_deleted())
    except Exception as exc:
        logger.exception("Could not delete vectors for note %s.", note_id)
        asyncio.run(_mark_outbox_failed(note_id, exc))
        raise
    return note_id
