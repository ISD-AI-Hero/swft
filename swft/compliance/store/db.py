"""
Database connection utilities for Azure Database for PostgreSQL.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator
from unittest.mock import Mock

import psycopg
from psycopg import Connection
from azure.identity import DefaultAzureCredential

from ..config import Config


# Mock connection for testing without a real database
mock_connection = Mock(spec=psycopg.Connection)


@contextmanager
def get_connection(config: Config) -> Iterator[Connection]:
    """
    Yield a psycopg connection configured for Azure AD or password auth.
    If SWFT_DB_HOST is not set, use a mock connection.
    """
    if not config.db.host:
        yield mock_connection
        return

    params = {
        "host": config.db.host,
        "port": config.db.port,
        "dbname": config.db.name,
        "user": config.db.user,
        "sslmode": "require",
        "connect_timeout": config.db.connect_timeout,
        "application_name": "swft-cli",
    }

    if config.db.auth_mode == "entra":
        token = _get_aad_token(config)
        params["password"] = token
    else:
        params["password"] = config.db.password

    with psycopg.connect(**params) as conn:
        yield conn


def _get_aad_token(config: Config) -> str:
    credential = DefaultAzureCredential(exclude_visual_studio_code_credential=True)
    token = credential.get_token(config.db.aad_scope)
    return token.token
