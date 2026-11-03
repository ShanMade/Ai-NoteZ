from __future__ import annotations

import asyncio
import hashlib
import uuid

import pytest
from fastapi import HTTPException
from redis.asyncio import Redis
from redis.exceptions import RedisError
from starlette.requests import Request

from app.core import auth as auth_module
from app.core.auth import get_current_user
from app.core.config import settings
from app.models import User
from app.schemas.common import AuthedUser
from app.api.deps import rate_limit


def test_firebase_identity_is_upserted_and_invalid_tokens_are_rejected(api_harness, monkeypatch):
    _, sessions = api_harness
    user_id = "firebase-user-test"
    monkeypatch.setattr(
        auth_module,
        "verify_id_token",
        lambda _token: {"uid": user_id, "email": "firebase@example.com", "name": "Firebase User"},
    )

    async def authenticate_and_read():
        async with sessions() as db:
            identity = await get_current_user("Bearer valid-test-token", db)
            row = await db.get(User, user_id)
            return identity, row

    identity, row = asyncio.run(authenticate_and_read())
    assert identity == AuthedUser(id=user_id, email="firebase@example.com")
    assert row is not None
    assert row.email == "firebase@example.com"
    assert row.display_name == "Firebase User"

    monkeypatch.setattr(
        auth_module,
        "verify_id_token",
        lambda _token: (_ for _ in ()).throw(ValueError("invalid test token")),
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(get_current_user("Bearer invalid-test-token"))
    assert error.value.status_code == 401


def test_recording_reads_use_polling_rate_limit_bucket(api_harness):
    """Recording status polling must not burn the general write budget.

    The record page polls session/speakers/parts every few seconds; counting
    those GETs against the 60/min general limit produced the 429s that
    stalled uploads and retries in production.
    """
    captured: list[tuple[int, str]] = []

    class FakeRedis:
        async def eval(self, _script, _num_keys, _key, _now, _window, limit, _member):
            captured.append((int(limit), _key))
            return [1, 0]

    def make_request(method: str, path: str) -> Request:
        return Request(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": path,
                "raw_path": path.encode(),
                "query_string": b"",
                "headers": [],
                "server": ("testserver", 80),
                "client": ("testclient", 1234),
            }
        )

    user = AuthedUser(id="polling-user")

    async def run():
        fake = FakeRedis()
        await rate_limit(make_request("GET", "/v1/record/sessions/abc"), user, fake)
        await rate_limit(make_request("GET", "/v1/record/sessions/abc/parts/0"), user, fake)
        await rate_limit(make_request("POST", "/v1/record/sessions/abc/parts"), user, fake)

    asyncio.run(run())
    assert captured[0][0] == settings.polling_rate_limit_per_minute
    assert captured[0][1].endswith(":poll")
    assert captured[1][0] == settings.polling_rate_limit_per_minute
    # Uploads stay on the general budget so polling can never starve them.
    assert captured[2][0] == settings.rate_limit_per_minute
    assert captured[2][1].endswith(":general")


def test_rate_limit_is_shared_between_redis_clients(api_harness, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    user = AuthedUser(id=f"rate-limit-{uuid.uuid4()}")
    request = Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/v1/notes",
            "raw_path": b"/v1/notes",
            "query_string": b"",
            "headers": [],
            "server": ("testserver", 80),
            "client": ("testclient", 1234),
        }
    )

    async def run():
        first_client = Redis.from_url(settings.redis_url, decode_responses=True)
        second_client = Redis.from_url(settings.redis_url, decode_responses=True)
        connected = False
        try:
            try:
                await first_client.ping()
            except RedisError:
                pytest.skip("Redis is unavailable; the Redis-backed rate test runs in CI.")
            connected = True
            await rate_limit(request, user, first_client)
            await rate_limit(request, user, second_client)
            with pytest.raises(HTTPException) as error:
                await rate_limit(request, user, second_client)
            assert error.value.status_code == 429
            assert error.value.headers["Retry-After"]
        finally:
            if connected:
                user_key = hashlib.sha256(user.id.encode("utf-8")).hexdigest()
                await first_client.delete(f"notez:rate:{user_key}:general")
            await first_client.aclose()
            await second_client.aclose()

    asyncio.run(run())
