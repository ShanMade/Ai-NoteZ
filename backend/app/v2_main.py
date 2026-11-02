from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from pathlib import Path
from typing import AsyncIterator

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .main import app as legacy_app
from .api.account import router as account_router
from .api.ai import router as ai_router
from .api.notes import router as notes_router
from .api.recording import router as recording_router
from .api.sync import router as sync_router
from .core.config import settings
from .core.db import engine
from .core.errors import register_exception_handlers
from .core.redis import redis_client
from .workers import outbox as _outbox_tasks  # noqa: F401
from .workers import tasks_transcribe as _transcription_tasks  # noqa: F401
from .workers import tasks_index as _indexing_tasks  # noqa: F401
from .workers import tasks_chat as _chat_tasks  # noqa: F401

logger = logging.getLogger(__name__)


def _migration_state(connection) -> tuple[set[str], set[str]]:
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "app" / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    current = set(MigrationContext.configure(connection).get_current_heads())
    return current, set(scripts.get_heads())


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        async with engine.connect() as connection:
            current, heads = await connection.run_sync(_migration_state)
        if current != heads:
            logger.warning("Database migrations are pending; apply `alembic upgrade head` before serving writes.")
    except SQLAlchemyError as exc:
        logger.warning("Could not check the database migration state during startup (%s).", type(exc).__name__)
    yield
    await redis_client.aclose()
    await engine.dispose()


def create_app() -> FastAPI:
    application = FastAPI(title="Notez API", version="2.0.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Retry-After"],
        max_age=600,
    )
    application.include_router(notes_router)
    application.include_router(sync_router)
    application.include_router(recording_router)
    application.include_router(account_router)
    application.include_router(ai_router)
    register_exception_handlers(application)

    @application.get("/livez", tags=["health"])
    async def livez() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/healthz", tags=["health"])
    async def healthz(response: Response) -> dict[str, bool | str]:
        database_ok = False
        redis_ok = False
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            database_ok = True
        except SQLAlchemyError as exc:
            logger.warning("Health check could not reach Postgres (%s).", type(exc).__name__)
        try:
            redis_ok = bool(await redis_client.ping())
        except RedisError as exc:
            logger.warning("Health check could not reach Redis (%s).", type(exc).__name__)
        if not database_ok or not redis_ok:
            response.status_code = 503
        return {
            "status": "ok" if database_ok and redis_ok else "degraded",
            "db": database_ok,
            "redis": redis_ok,
        }

    application.mount("/", legacy_app, name="legacy-api")
    return application


app = create_app()
