from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import Response
from sqlalchemy.exc import SQLAlchemyError

from app import v2_main


def test_healthz_returns_service_unavailable_when_database_is_down(monkeypatch) -> None:
    class FailedConnection:
        async def __aenter__(self):
            raise SQLAlchemyError("database unavailable")

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(v2_main, "engine", SimpleNamespace(connect=FailedConnection))
    monkeypatch.setattr(v2_main.redis_client, "ping", AsyncMock(return_value=True))
    response = Response()

    health_endpoint = next(
        route.endpoint
        for route in v2_main.app.routes
        if getattr(route, "path", None) == "/healthz"
    )
    result = asyncio.run(health_endpoint(response))

    assert response.status_code == 503
    assert result == {"status": "degraded", "db": False, "redis": True}


def test_livez_does_not_depend_on_external_services() -> None:
    live_endpoint = next(
        route.endpoint
        for route in v2_main.app.routes
        if getattr(route, "path", None) == "/livez"
    )

    assert asyncio.run(live_endpoint()) == {"status": "ok"}
