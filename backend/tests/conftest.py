from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("FIREBASE_PROJECT_ID", "notez-test")
os.environ.setdefault(
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    '{"type":"service_account","project_id":"notez-test"}',
)

from app.api.deps import rate_limit  # noqa: E402
from app.core.auth import get_current_user  # noqa: E402
from app.core.db import get_db  # noqa: E402
from app.models import Base, User  # noqa: E402
from app.schemas.common import AuthedUser  # noqa: E402
from app.v2_main import app  # noqa: E402

TEST_USER_ID = "test-user"


@pytest.fixture
def api_harness(tmp_path: Path):
    database_path = tmp_path / "notez-test.sqlite3"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
        poolclass=NullPool,
    )

    @event.listens_for(engine.sync_engine, "connect")
    def install_postgres_search_function(dbapi_connection, _connection_record) -> None:
        dbapi_connection.create_function(
            "to_tsvector",
            2,
            lambda _language, content: content,
            deterministic=True,
        )

    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare_database() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            session.add(User(id=TEST_USER_ID, email="test@example.com"))
            await session.commit()

    asyncio.run(prepare_database())

    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[rate_limit] = lambda: AuthedUser(id=TEST_USER_ID, email="test@example.com")
    app.dependency_overrides[get_current_user] = lambda: AuthedUser(id=TEST_USER_ID, email="test@example.com")
    client = TestClient(app)
    try:
        yield client, sessions
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())
