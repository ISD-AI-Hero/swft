"""
Configuration loader for the compliance CLI.

The loader merges values in the following precedence order:
1. Command-line overrides (handled by Typer options)
2. Environment variables / .env
3. swft.toml (if present)
4. Built-in defaults
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import os
import tomllib

from dotenv import load_dotenv


DEFAULT_AAD_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"


@dataclass(slots=True)
class PathsConfig:
    home: Path
    store: Path
    pinned: Path
    outputs: Path

    def ensure(self) -> None:
        for path in (self.home, self.store, self.pinned, self.outputs):
            path.mkdir(parents=True, exist_ok=True)


@dataclass(slots=True)
class DbConfig:
    host: str
    port: int
    name: str
    user: str
    auth_mode: str
    password: str | None
    aad_scope: str
    connect_timeout: int


@dataclass(slots=True)
class Config:
    paths: PathsConfig
    db: DbConfig


def load_config(config_path: Path | None = None) -> Config:
    """Load configuration from files and environment variables."""
    _load_env_file()
    toml_data = _load_toml(config_path)
    paths = _build_paths_config(toml_data)
    db = _build_db_config(toml_data)
    return Config(paths=paths, db=db)


def _load_env_file() -> None:
    """Load `.env` files from common repo locations without clobbering existing env."""
    module_root = Path(__file__).resolve().parents[2]
    backend_env = module_root / "backend" / ".env"
    repo_env = module_root / ".env"
    for path in (backend_env, repo_env):
        load_dotenv(path, override=False)
    load_dotenv(override=False)  # fallback to default discovery


def _load_toml(config_path: Path | None) -> dict[str, Any]:
    """Read swft.toml or an explicitly supplied file if present."""
    path = config_path
    if path is None:
        default = Path("swft.toml")
        if default.exists():
            path = default
    if path is None or not path.exists():
        return {}
    with path.open("rb") as fh:
        return tomllib.load(fh)


def _build_paths_config(data: dict[str, Any]) -> PathsConfig:
    section = data.get("paths", {})
    home = Path(
        os.environ.get("SWFT_HOME")
        or section.get("home")
        or (Path.home() / ".swft")
    )
    store = Path(
        os.environ.get("SWFT_STORE")
        or section.get("store")
        or (home / "store")
    )
    pinned = Path(
        os.environ.get("SWFT_PINNED")
        or section.get("pinned")
        or (home / "pinned")
    )
    outputs = Path(
        os.environ.get("SWFT_OUTPUTS")
        or section.get("outputs")
        or (home / "outputs")
    )
    return PathsConfig(home=home.expanduser(), store=store.expanduser(), pinned=pinned.expanduser(), outputs=outputs.expanduser())


def _build_db_config(data: dict[str, Any]) -> DbConfig:
    section = data.get("db", {})
    host = os.environ.get("SWFT_DB_HOST") or section.get("host") or "mock_host"
    name = os.environ.get("SWFT_DB_NAME") or section.get("name") or "mock_db"
    user = os.environ.get("SWFT_DB_USER") or section.get("user") or "mock_user"
    auth_mode = os.environ.get("SWFT_DB_AUTH") or section.get("auth", "entra")
    if auth_mode not in {"entra", "password"}:
        raise ValueError("SWFT_DB_AUTH must be 'entra' or 'password'")
    password = os.environ.get("SWFT_DB_PASSWORD") or section.get("password") or "mock_password"
    aad_scope = os.environ.get("SWFT_DB_AAD_SCOPE") or section.get("aad_scope") or DEFAULT_AAD_SCOPE
    port = int(os.environ.get("SWFT_DB_PORT") or section.get("port") or 5432)
    timeout = int(os.environ.get("SWFT_DB_TIMEOUT") or section.get("timeout") or 30)
    return DbConfig(
        host=host,
        port=port,
        name=name,
        user=user,
        auth_mode=auth_mode,
        password=password,
        aad_scope=aad_scope,
        connect_timeout=timeout,
    )


def _require(env_key: str, file_value: Any) -> str:
    value = os.environ.get(env_key) or file_value
    if not value:
        raise ValueError(f"{env_key} is required. Provide it via .env or swft.toml.")
    return str(value)
