from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from ...core.config import AppSettings
from ...core.security import UserContext
from ...services.catalog import parse_blob_key
from ...services.exceptions import RepositoryError
from ...services.repository import AzureBlobRepository, BlobRecord
from ..deps import get_settings_dep, get_user

logger = logging.getLogger("swft.backend.storage")

router = APIRouter(prefix="/storage", tags=["storage"])


def _repo(settings: AppSettings) -> AzureBlobRepository:
    # Reuse the same repository implementation used by the artifact catalog.
    return AzureBlobRepository(settings.storage, settings.auth)


def _enforce_project_acl(user: UserContext, blob_name: str, delimiter: str) -> None:
    """If the user context is scoped to allowed_projects, enforce that this blob is within scope."""
    if not user.allowed_projects:
        return
    try:
        project_id, _run_id, _artifact = parse_blob_key(blob_name, delimiter)
    except Exception:
        # If we can't parse it, deny by default when ACLs are present.
        raise HTTPException(status_code=403, detail="Access denied.")
    if project_id not in user.allowed_projects:
        raise HTTPException(status_code=403, detail="Access denied.")


@router.get("/{container}/blobs", response_model=dict[str, Any])
def list_blobs(
    container: str = Path(..., description="Azure Storage container name"),
    prefix: Optional[str] = Query(None, description="Optional blob name prefix filter"),
    limit: int = Query(200, ge=1, le=2000, description="Maximum number of blobs to return"),
    settings: AppSettings = Depends(get_settings_dep),
    user: UserContext = Depends(get_user),
) -> dict[str, Any]:
    """List blobs in a container (optionally filtered by prefix).

    Notes:
    - This is intended for *report browsing* scenarios in the portal.
    - If `user.allowed_projects` is set, results are filtered to only those projects.
    """
    repo = _repo(settings)
    try:
        results: list[dict[str, Any]] = []
        count = 0
        for record in repo.list_blobs(container):
            if prefix and not record.name.startswith(prefix):
                continue
            if user.allowed_projects:
                # Filter to allowed projects.
                try:
                    project_id, _run_id, _artifact = parse_blob_key(record.name, settings.storage.delimiter)
                except Exception:
                    continue
                if project_id not in user.allowed_projects:
                    continue
            results.append(
                {
                    "name": record.name,
                    "lastModified": record.last_modified.isoformat() if record.last_modified else None,
                    "sizeBytes": record.size,
                }
            )
            count += 1
            if count >= limit:
                break
        return {"container": container, "count": len(results), "blobs": results}
    except RepositoryError as exc:
        logger.exception("Failed listing blobs in container '%s'", container)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{container}/blobs/{blob_name:path}", response_model=dict[str, Any])
def read_blob_text(
    container: str = Path(..., description="Azure Storage container name"),
    blob_name: str = Path(..., description="Blob name (use full path inside the container)"),
    max_chars: int = Query(2_000_000, ge=1_000, le=10_000_000, description="Safety limit for returned text"),
    settings: AppSettings = Depends(get_settings_dep),
    user: UserContext = Depends(get_user),
) -> dict[str, Any]:
    """Download a blob and return its text content.

    If you store non-text (PDF, images), this will fail. For those, add a streaming endpoint.
    """
    _enforce_project_acl(user, blob_name, settings.storage.delimiter)
    repo = _repo(settings)
    try:
        content = repo.download_text(container, blob_name)
    except RepositoryError as exc:
        logger.exception("Failed downloading blob '%s' from '%s'", blob_name, container)
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if len(content) > max_chars:
        content = content[:max_chars] + "\n\n... (truncated)"

    return {"container": container, "name": blob_name, "content": content}


@router.get("/{container}/json/{blob_name:path}", response_model=dict[str, Any])
def read_blob_json(
    container: str = Path(..., description="Azure Storage container name"),
    blob_name: str = Path(..., description="Blob name (use full path inside the container)"),
    pretty: bool = Query(False, description="Pretty-print JSON for easier reading"),
    max_chars: int = Query(2_000_000, ge=1_000, le=10_000_000, description="Safety limit for returned JSON text"),
    settings: AppSettings = Depends(get_settings_dep),
    user: UserContext = Depends(get_user),
) -> dict[str, Any]:
    """Download a blob and return parsed JSON.

    Use this for report artifacts that are JSON. If the blob isn't valid JSON, returns 422.
    """
    _enforce_project_acl(user, blob_name, settings.storage.delimiter)
    repo = _repo(settings)

    try:
        raw = repo.download_text(container, blob_name)
    except RepositoryError as exc:
        logger.exception("Failed downloading blob '%s' from '%s'", blob_name, container)
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if len(raw) > max_chars:
        raw = raw[:max_chars] + "\n\n... (truncated)"

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Blob is not valid JSON.",
                "line": exc.lineno,
                "col": exc.colno,
            },
        ) from exc

    if pretty:
        # Return a pretty string for UI text viewers.
        rendered = json.dumps(data, indent=2, ensure_ascii=False)
        if len(rendered) > max_chars:
            rendered = rendered[:max_chars] + "\n\n... (truncated)"
        return {"container": container, "name": blob_name, "json": data, "pretty": rendered}

    return {"container": container, "name": blob_name, "json": data}
