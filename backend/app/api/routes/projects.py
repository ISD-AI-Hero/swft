from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from typing import Sequence
import logging

from ...models.api import ProjectSummaryModel
from ...services.catalog import ArtifactCatalogService
from ...services.exceptions import RepositoryError
from ..deps import get_catalog, get_user
from ...core.security import UserContext

router = APIRouter(prefix="/projects", tags=["projects"])

logger = logging.getLogger("swft.backend.projects")


def _to_model(summary) -> ProjectSummaryModel: return ProjectSummaryModel(project_id=summary.project_id, run_count=summary.run_count, latest_run_at=summary.latest_run_at, latest_overall_risk_level=summary.latest_overall_risk_level)


@router.get("", response_model=Sequence[ProjectSummaryModel])
def list_projects(catalog: ArtifactCatalogService = Depends(get_catalog), user: UserContext = Depends(get_user)) -> Sequence[ProjectSummaryModel]:
    """Return all catalogued projects, applying RBAC filters for the current user."""
    try:
        summaries = catalog.list_projects()
    except RepositoryError as exc:
        logger.exception("Failed to list projects")
        raise HTTPException(status_code=500, detail="Failed to enumerate projects.") from exc
    if user.allowed_projects:
        # Easy RBAC guard: trim the catalog list to the projects granted by resolve_user.
        summaries = [item for item in summaries if item.project_id in user.allowed_projects]
    return [_to_model(item) for item in summaries]
