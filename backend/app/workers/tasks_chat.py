from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging

from sqlalchemy import delete

from ..core.celery_app import celery_app
from ..core.db import AsyncSessionLocal
from ..models import ChatHistory

logger = logging.getLogger(__name__)


async def _purge_old_messages() -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=183)
    async with AsyncSessionLocal() as db:
        result = await db.execute(delete(ChatHistory).where(ChatHistory.created_at < cutoff))
        await db.commit()
        return int(result.rowcount or 0)


@celery_app.task(name="chat.purge_old")
def purge_old_chat_history() -> int:
    try:
        return asyncio.run(_purge_old_messages())
    except Exception:
        logger.exception("Could not purge old AI chat history.")
        raise
