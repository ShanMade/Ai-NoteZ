from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.firebase import verify_id_token

from ..models import User
from ..schemas.common import AuthedUser
from .db import get_db


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> AuthedUser:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A Firebase bearer token is required.")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A Firebase bearer token is required.")

    try:
        claims = verify_id_token(token.strip())
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase authentication is temporarily unavailable.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The Firebase ID token is invalid or expired.") from exc

    user_id = claims.get("uid")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The Firebase identity has no user ID.")

    email = claims.get("email")
    display_name = claims.get("name")
    async with db.begin():
        values = dict(
            id=user_id,
            email=email if isinstance(email, str) else None,
            display_name=display_name if isinstance(display_name, str) else None,
        )
        dialect = db.get_bind().dialect.name
        if dialect == "postgresql":
            statement = pg_insert(User).values(**values)
        elif dialect == "sqlite":
            statement = sqlite_insert(User).values(**values)
        else:
            raise RuntimeError(f"User upsert is not configured for database dialect {dialect!r}.")
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=[User.id],
                set_={
                    "email": statement.excluded.email,
                    "display_name": statement.excluded.display_name,
                    "updated_at": func.now(),
                },
            )
        )

    return AuthedUser(id=user_id, email=email if isinstance(email, str) else None)


CurrentUser = Annotated[AuthedUser, Depends(get_current_user)]
