from __future__ import annotations

import hashlib
import secrets
import time
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from redis.asyncio import Redis
from redis.exceptions import RedisError

from ..core.auth import CurrentUser
from ..core.config import settings
from ..core.redis import get_redis
from ..schemas.common import AuthedUser

_SLIDING_WINDOW = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
"""


async def rate_limit(
    request: Request,
    user: CurrentUser,
    redis: Redis = Depends(get_redis),
) -> AuthedUser:
    is_polling = request.url.path.endswith("/sync/delta")
    limit = settings.polling_rate_limit_per_minute if is_polling else settings.rate_limit_per_minute
    now_ms = int(time.time() * 1000)
    window_ms = 60_000
    user_key = hashlib.sha256(user.id.encode("utf-8")).hexdigest()
    key = f"notez:rate:{user_key}:{'poll' if is_polling else 'general'}"
    try:
        allowed, retry_after = await redis.eval(
            _SLIDING_WINDOW,
            1,
            key,
            now_ms,
            window_ms,
            limit,
            f"{now_ms}:{secrets.token_urlsafe(12)}",
        )
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Rate limiting is temporarily unavailable.",
        ) from exc
    if not int(allowed):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Request limit reached. Try again shortly.",
            headers={"Retry-After": str(int(retry_after))},
        )
    return user


RateLimitedUser = Annotated[AuthedUser, Depends(rate_limit)]
