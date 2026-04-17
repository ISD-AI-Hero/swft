from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Sequence

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class UserContext:
    subject: str
    name: str | None = None
    email: str | None = None
    allowed_projects: Sequence[str] | None = None


class AuthSettings(BaseSettings):
    """Entra ID JWT validation settings loaded from environment / .env."""

    enabled: bool = Field(default=True, alias="AUTH_ENABLED")
    tenant_id: str | None = Field(default=None, alias="AZURE_TENANT_ID")
    # Client ID of the *backend* app registration — used as the expected token audience.
    client_id: str | None = Field(default=None, alias="AUTH_CLIENT_ID")
    # Base authority URL without tenant path (default: Azure Government).
    authority_host: str = Field(
        default="https://login.microsoftonline.us", alias="AUTH_AUTHORITY_HOST"
    )

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @property
    def jwks_uri(self) -> str:
        return f"{self.authority_host.rstrip('/')}/{self.tenant_id}/discovery/v2.0/keys"

    @property
    def issuer(self) -> str:
        return f"{self.authority_host.rstrip('/')}/{self.tenant_id}/v2.0"


@lru_cache
def _get_auth_settings() -> AuthSettings:
    return AuthSettings()


# Module-level JWKS client — lazily created, keys cached for 1 hour.
_jwks_client: jwt.PyJWKClient | None = None


def _get_jwks_client(settings: AuthSettings) -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            settings.jwks_uri, cache_keys=True, lifespan=3600
        )
    return _jwks_client


def _validate_token(token: str, settings: AuthSettings) -> dict:
    client = _get_jwks_client(settings)
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.client_id,
        issuer=settings.issuer,
        options={"verify_exp": True},
    )


async def resolve_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserContext:
    """Validate an Entra ID Bearer token and return a UserContext.

    When AUTH_ENABLED=false (local dev) the guard is bypassed and an anonymous
    context is returned so all routes remain accessible without a token.
    """
    settings = _get_auth_settings()

    if not settings.enabled:
        return UserContext(subject="local-dev", name="Local Dev (auth disabled)")

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not settings.tenant_id or not settings.client_id:
        logger.error(
            "AUTH_ENABLED=true but AZURE_TENANT_ID or AUTH_CLIENT_ID is not set"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server authentication is misconfigured.",
        )

    try:
        claims = _validate_token(credentials.credentials, settings)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return UserContext(
        subject=claims.get("oid") or claims.get("sub", "unknown"),
        name=claims.get("name"),
        email=claims.get("preferred_username") or claims.get("email"),
    )
