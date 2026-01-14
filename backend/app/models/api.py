from __future__ import annotations

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Mapping, Sequence


class ArtifactModel(BaseModel):
    project_id: str = Field(..., description="Logical project identifier")
    run_id: str = Field(..., description="GitHub Actions run identifier")
    artifact_type: str = Field(..., description="Artifact classification (sbom, trivy, run, appdesign, codeql, sonarqube, dockerinspect, finalassessment, other)")
    blob_name: str = Field(..., description="Blob object key")
    container: str = Field(..., description="Azure container name")
    last_modified: datetime | None = Field(default=None, description="Last modified timestamp from blob metadata")
    size_bytes: int | None = Field(default=None, description="Blob size in bytes")


class RunSummaryModel(BaseModel):
    project_id: str
    run_id: str
    created_at: datetime | None
    artifact_counts: Mapping[str, int]
    sbom_component_total: int | None
    cosign_status: str | None
    trivy_findings_total: int | None
    trivy_findings_failset: int | None
    final_assessment_findings_total: int | None
    final_assessment_findings_failset: int | None
    final_assessment_overall_risk_level: str | None
    deployment_url: str | None


class ProjectSummaryModel(BaseModel):
    project_id: str
    run_count: int
    latest_run_at: datetime | None
    latest_overall_risk_level: str | None = None


class RunDetailModel(BaseModel):
    summary: RunSummaryModel
    artifacts: Sequence[ArtifactModel]
    metadata: Mapping[str, object]
