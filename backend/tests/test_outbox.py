from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import uuid

from sqlalchemy import select

from app.models import Note, Outbox
from app.workers import outbox as outbox_worker

TEST_USER_ID = "test-user"


def test_outbox_reclaims_stale_processing_rows(api_harness, monkeypatch):
    _, sessions = api_harness
    dispatched_tasks: list[tuple[str, list[str]]] = []

    async def seed_stale_event() -> tuple[uuid.UUID, uuid.UUID]:
        async with sessions() as db:
            note = Note(user_id=TEST_USER_ID, title="Stale event")
            db.add(note)
            await db.flush()
            stale_time = datetime.now(timezone.utc) - timedelta(minutes=10)
            event = Outbox(
                note_id=note.id,
                event="upsert",
                status="processing",
                attempts=1,
                next_attempt_at=stale_time,
                updated_at=stale_time,
            )
            db.add(event)
            await db.commit()
            return note.id, event.id

    note_id, event_id = asyncio.run(seed_stale_event())
    monkeypatch.setattr(outbox_worker, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(
        outbox_worker.celery_app,
        "send_task",
        lambda task_name, *, args: dispatched_tasks.append((task_name, args)),
    )

    assert asyncio.run(outbox_worker._dispatch_pending()) == 1
    assert dispatched_tasks == [("indexing.index_note", [str(note_id)])]

    async def read_dispatched_event():
        async with sessions() as db:
            return await db.get(Outbox, event_id)

    event = asyncio.run(read_dispatched_event())
    assert event is not None
    assert event.status == "processing"
    assert event.attempts == 2
