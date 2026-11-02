from __future__ import annotations

from celery import Celery

from .config import settings

celery_app = Celery("notez", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_routes={
        "transcription.*": {"queue": "transcription"},
        "indexing.*": {"queue": "indexing"},
    },
    beat_schedule={
        "process-outbox": {
            "task": "outbox.process",
            "schedule": 2.0,
        },
        "purge-chat-history": {
            "task": "chat.purge_old",
            "schedule": 86400.0,
        },
    },
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    imports=(
        "app.workers.outbox",
        "app.workers.tasks_transcribe",
        "app.workers.tasks_index",
        "app.workers.tasks_chat",
    ),
)
