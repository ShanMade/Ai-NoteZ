from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import Response
from fastapi.testclient import TestClient
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


def test_cors_allows_configured_public_frontend_url(monkeypatch) -> None:
    frontend_origin = "https://ai-notez.web.app"
    monkeypatch.setattr(v2_main.settings, "cors_origins", [])
    monkeypatch.setattr(v2_main.settings, "public_frontend_url", frontend_origin)

    response = TestClient(v2_main.create_app()).options(
        "/v1/notes",
        headers={
            "Origin": frontend_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == frontend_origin
    assert "GET" in response.headers["access-control-allow-methods"]
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers
