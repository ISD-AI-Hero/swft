from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from typing import Sequence
import logging

from ...models.api import RunSummaryModel, RunDetailModel, ArtifactModel
from ...services.catalog import ArtifactCatalogService
from ...services.exceptions import NotFoundError, RepositoryError
from ..deps import get_catalog, get_user
from ...core.security import UserContext

router = APIRouter(prefix="/projects/{project_id}/runs", tags=["runs"])

logger = logging.getLogger("swft.backend.runs")


def _summary_model(summary) -> RunSummaryModel:
    """Map a domain-level RunSummary into the API response model."""
    return RunSummaryModel(
        project_id=summary.project_id,
        run_id=summary.run_id,
        created_at=summary.created_at,
        artifact_counts=summary.artifact_counts,
        sbom_component_total=summary.sbom_component_total,
        cosign_status=summary.cosign_status,
        trivy_findings_total=summary.trivy_findings_total,
        trivy_findings_failset=summary.trivy_findings_failset,
        final_assessment_findings_total=summary.final_assessment_findings_total,
        final_assessment_findings_failset=summary.final_assessment_findings_failset,
        final_assessment_overall_risk_level=summary.final_assessment_overall_risk_level,
        deployment_url=summary.deployment_url,
    )


def _artifact_model(artifact) -> ArtifactModel:
    """Transform an ArtifactDescriptor into the serialized response shape."""
    return ArtifactModel(
        project_id=artifact.project_id,
        run_id=artifact.run_id,
        artifact_type=artifact.artifact_type,
        blob_name=artifact.blob_name,
        container=artifact.container,
        last_modified=artifact.last_modified,
        size_bytes=artifact.size_bytes,
    )


VALID_WINDOWS = {2, 3, 5, 7, 9, 11}


@router.get("", response_model=Sequence[RunSummaryModel])
def list_runs(project_id: str = Path(..., description="Project identifier"), limit: int | None = Query(default=None, description="Maximum number of recent runs to return", ge=2, le=11), catalog: ArtifactCatalogService = Depends(get_catalog), user: UserContext = Depends(get_user)) -> Sequence[RunSummaryModel]:
    """Return run summaries for the chosen project, optionally capped by ``limit``."""
    if user.allowed_projects and project_id not in user.allowed_projects:
        raise HTTPException(status_code=403, detail="Access to project denied.")
    if limit is not None and limit not in VALID_WINDOWS:
        # Keep the window sizes aligned with what the frontend offers so caching stays effective.
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported limit '{limit}'. Valid values: {sorted(VALID_WINDOWS)}",
        )
    try:
        summaries = catalog.list_runs(project_id, limit=limit)
    except RepositoryError as exc:
        logger.exception("Failed to list runs for project '%s'", project_id)
        raise HTTPException(
            status_code=500, detail="Failed to enumerate runs."
        ) from exc
    return [_summary_model(item) for item in summaries]


@router.get("/{run_id}", response_model=RunDetailModel)
def get_run(project_id: str = Path(..., description="Project identifier"), run_id: str = Path(..., description="Run identifier"), catalog: ArtifactCatalogService = Depends(get_catalog), user: UserContext = Depends(get_user)) -> RunDetailModel:
    """Return detailed metadata and artifacts for an individual run."""
    if user.allowed_projects and project_id not in user.allowed_projects:
        raise HTTPException(status_code=403, detail="Access to project denied.")
    try:
        # Run detail already includes artifacts; no need for separate repository calls here.
        detail = catalog.run_detail(project_id, run_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RepositoryError as exc:
        logger.exception("Failed to load run '%s' for project '%s'", run_id, project_id)
        raise HTTPException(
            status_code=500, detail="Failed to load run detail."
        ) from exc
    artifacts = [_artifact_model(item) for item in detail.artifacts]
    summary = _summary_model(detail.summary)
    return RunDetailModel(
        summary=summary, artifacts=artifacts, metadata=detail.metadata
    )
