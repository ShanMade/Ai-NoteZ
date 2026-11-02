from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.core.db import AsyncSessionLocal
from app.models import Note
from app.services.rag.qdrant_client import ensure_collections
from app.workers.tasks_index import index_note


async def enqueue_rebuild() -> int:
    await asyncio.to_thread(ensure_collections)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Note.id).where(Note.deleted_at.is_(None)).order_by(Note.id)
        )
        note_ids = list(result.scalars().all())
    for note_id in note_ids:
        index_note.delay(str(note_id))
    return len(note_ids)


if __name__ == "__main__":
    print(f"Queued {asyncio.run(enqueue_rebuild())} notes for re-indexing.")
