from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import projects as projects_router
from .api.routes import runs as runs_router
from .api.routes import artifacts as artifacts_router
from .core.logging import configure_logging
from .api.routes import assistant as assistant_router
# from .api.routes import swft as swft_router
from .api.routes import storage as storage_router


def _allowed_origins() -> list[str]:
    """Return CORS allowed origins from the ALLOWED_ORIGINS env var (comma-separated).

    Falls back to ``["*"]`` for local development when the variable is unset.
    In production (AUTH_ENABLED=true) an unset ALLOWED_ORIGINS logs a startup warning
    because a wildcard origin allows any website to call the API.
    """
    import logging as _logging
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if not raw:
        auth_enabled = os.environ.get("AUTH_ENABLED", "true").lower() not in ("false", "0", "no")
        if auth_enabled:
            _logging.getLogger(__name__).warning(
                "SECURITY: ALLOWED_ORIGINS is not set but AUTH_ENABLED=true. "
                "The API accepts requests from any origin (*). "
                "Set ALLOWED_ORIGINS to a comma-separated list of allowed origins."
            )
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


def create_app() -> FastAPI:
    """Assemble the FastAPI application with middleware, routes, and logging."""
    configure_logging()
    # Single FastAPI instance hosts the public API consumed by the portal frontend.
    app = FastAPI(title="SWFT Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins(),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(projects_router.router)
    app.include_router(runs_router.router)
    app.include_router(artifacts_router.router)
    app.include_router(assistant_router.router)
    # app.include_router(swft_router.router)
    app.include_router(storage_router.router)
    return app


app = create_app()

@app.get("/")
def root():
    return {"status":"ok", "service":"swft-backend"}
