from __future__ import annotations

from typing import Any

import jwt
from fastapi import Header, HTTPException, Request
from jwt import PyJWKClient

from paperpilot.config import settings
from paperpilot.logging import log

jwks_client = PyJWKClient(settings.supabase_jwks_url, cache_keys=True)


class AuthError(HTTPException):
    def __init__(self, detail: str = "Not authenticated") -> None:
        super().__init__(status_code=401, detail=detail)


def verify_token(token: str) -> dict[str, Any]:
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token).key
        payload: dict[str, Any] = jwt.decode(
            token,
            signing_key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthError("Token has expired")
    except jwt.PyJWKClientError as e:
        log.error("jwks_fetch_failed", error=str(e))
        raise AuthError("Unable to verify token signing key")
    except jwt.InvalidTokenError as e:
        log.warning("invalid_token", error=str(e))
        raise AuthError("Invalid authentication token")


async def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str:
    if not authorization:
        raise AuthError("Missing Authorization header")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise AuthError("Authorization header must be: Bearer <token>")

    payload = verify_token(token)
    request.state.access_token = token
    user_id: str = payload.get("sub", "")
    if not user_id:
        raise AuthError("Token missing user ID (sub claim)")

    request.state.user_id = user_id
    request.state.user_email = payload.get("email", "")
    return user_id
