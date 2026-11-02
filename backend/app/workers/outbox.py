from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging

from celery.exceptions import CeleryError
from kombu.exceptions import OperationalError
from redis.exceptions import RedisError
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import SQLAlchemyError

from ..core.celery_app import celery_app
from ..core.db import AsyncSessionLocal
from ..models import Outbox

logger = logging.getLogger(__name__)
_TASKS = {
    "upsert": "indexing.index_note",
    "delete": "indexing.delete_note",
    "facet_extract": "indexing.index_note",
}


async def _dispatch_pending() -> int:
    async with AsyncSessionLocal() as db:
        async with db.begin():
            now = datetime.now(timezone.utc)
            result = await db.execute(
                select(Outbox)
                .where(
                    Outbox.next_attempt_at <= now,
                    or_(
                        Outbox.status == "pending",
                        Outbox.status == "failed",
                        and_(
                            Outbox.status == "processing",
                            Outbox.updated_at <= now - timedelta(minutes=5),
                        ),
                    ),
                )
                .order_by(Outbox.created_at, Outbox.id)
                .limit(100)
                .with_for_update(skip_locked=True)
            )
            claimed = list(result.scalars().all())
            for item in claimed:
                item.status = "processing"
                item.attempts += 1

        dispatched = 0
        for item in claimed:
            try:
                celery_app.send_task(_TASKS[item.event], args=[str(item.note_id)])
            except (CeleryError, OperationalError, RedisError, OSError) as exc:
                logger.warning("Outbox dispatch failed for row %s (%s).", item.id, type(exc).__name__)
                async with db.begin():
                    item.status = "failed"
                    item.last_error = f"Dispatch failed: {type(exc).__name__}"
                    item.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                        seconds=min(3600, 2 ** min(item.attempts, 12))
                    )
            else:
                dispatched += 1
        return dispatched


@celery_app.task(name="outbox.process")
def process_outbox() -> int:
    try:
        return asyncio.run(_dispatch_pending())
    except SQLAlchemyError:
        logger.exception("Outbox polling failed while accessing Postgres")
        raise
