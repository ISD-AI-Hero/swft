from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Mapping, Sequence


@dataclass(frozen=True, slots=True)
class ArtifactDescriptor:
    project_id: str
    run_id: str
    artifact_type: str
    blob_name: str
    container: str
    last_modified: datetime | None = None
    size_bytes: int | None = None


@dataclass(frozen=True, slots=True)
class RunSummary:
    project_id: str
    run_id: str
    created_at: datetime | None
    artifact_counts: Mapping[str, int] = field(default_factory=dict)
    sbom_component_total: int | None = None
    cosign_status: str | None = None
    trivy_findings_total: int | None = None
    trivy_findings_failset: int | None = None
    final_assessment_findings_total: int | None = None
    final_assessment_findings_failset: int | None = None
    final_assessment_overall_risk_level: str | None = None
    deployment_url: str | None = None


@dataclass(frozen=True, slots=True)
class ProjectSummary:
    project_id: str
    run_count: int
    latest_run_at: datetime | None
    latest_overall_risk_level: str | None = None


@dataclass(frozen=True, slots=True)
class RunDetail:
    summary: RunSummary
    artifacts: Sequence[ArtifactDescriptor]
    metadata: Mapping[str, object]
