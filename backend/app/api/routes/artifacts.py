from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path
from typing import Any

from ...services.catalog import ArtifactCatalogService
from ...services.exceptions import NotFoundError, RepositoryError
from ..deps import get_catalog, get_user
from ...core.security import UserContext
import logging

logger = logging.getLogger("swft.backend.artifacts")

router = APIRouter(prefix="/projects/{project_id}/runs/{run_id}/artifacts", tags=["artifacts"])


@router.get("/{artifact_type}", response_model=dict[str, Any] | list[dict[str, Any]])
def fetch_artifact(project_id: str = Path(..., description="Project identifier"), run_id: str = Path(..., description="Run identifier"), artifact_type: str = Path(..., description="Artifact type (sbom|trivy|run|appdesign|codeql|sonarqube|dockerinspect|finalassessment|other)"), catalog: ArtifactCatalogService = Depends(get_catalog), user: UserContext = Depends(get_user)) -> dict[str, Any] | list[dict[str, Any]]:
    """Return the raw JSON payload for a specific artifact if the user has access."""
    if user.allowed_projects and project_id not in user.allowed_projects:
        raise HTTPException(status_code=403, detail="Access to project denied.")
    try:
        detail = catalog.run_detail(project_id, run_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RepositoryError as exc:
        logger.exception("Failed to load run '%s' for project '%s' while fetching artifact '%s'", run_id, project_id, artifact_type)
        raise HTTPException(status_code=500, detail="Failed to load artifact metadata.") from exc
    # Filter out .sig files (signature files should not be fetched as artifacts)
    matches = [
        artifact for artifact in detail.artifacts 
        if artifact.artifact_type == artifact_type and not artifact.blob_name.endswith('.sig')
    ]
    if not matches:
        raise HTTPException(status_code=404, detail=f"Artifact '{artifact_type}' not available for run '{run_id}'.")
    
    # Prefer text-based artifacts over binary ones, with type-specific preferences
    def artifact_priority(artifact) -> int:
        """Return priority: lower number = higher priority. Prefer text-based files."""
        blob_name = artifact.blob_name.lower()
        
        # Type-specific preferences
        if artifact_type == "trivy":
            # Prefer trivy-report.json over trivy-results.sarif
            if blob_name.endswith('trivy-report.json'):
                return 0  # Highest priority
            if blob_name.endswith('trivy-results.sarif'):
                return 1  # Second priority
            if blob_name.endswith('.json'):
                return 2  # Other JSON files
            if blob_name.endswith('.sarif'):
                return 3  # Other SARIF files
        
        if artifact_type == "finalassessment":
            # Prefer final_assessment_*.json pattern (matches frontend expectation)
            if blob_name.startswith('final_assessment_') and blob_name.endswith('.json'):
                return 0  # Highest priority
            if blob_name.endswith('.json'):
                return 1  # Other JSON files
            return 5  # Other files
        
        if artifact_type == "dockerinspect":
            # Prefer *docker-inspect.json pattern (matches frontend expectation)
            if blob_name.endswith('docker-inspect.json'):
                return 0  # Highest priority
            if blob_name.endswith('.json'):
                return 1  # Other JSON files
            return 5  # Other files
        
        if artifact_type == "codeql":
            # Prefer codeql.sarif over codeql-db.tar.gz
            if blob_name.endswith('codeql.sarif'):
                return 0  # Highest priority
            if blob_name.endswith('.sarif'):
                return 1  # Other SARIF files
            if blob_name.endswith('.json'):
                return 2  # JSON files
            if blob_name.endswith(('.tar.gz', '.zip', '.tgz')):
                return 10  # Binary files
        
        if artifact_type == "sonarqube":
            # Prefer sonarqube_scan.json pattern
            if blob_name.endswith('sonarqube_scan.json'):
                return 0  # Highest priority
            if blob_name.endswith('.json'):
                return 1  # Other JSON files
            return 5  # Other files
        
        # Binary file extensions get lower priority
        if blob_name.endswith(('.tar.gz', '.zip', '.tgz')):
            return 10
        # Text-based extensions get higher priority
        if blob_name.endswith(('.sarif', '.json', '.md', '.txt')):
            return 0
        return 5  # Unknown extensions
    
    # Sort by priority, then take the first (highest priority) one
    matches.sort(key=artifact_priority)
    descriptor = matches[0]
    
    # Option 2: Validate that selected artifact matches expected patterns
    def validate_artifact_pattern(artifact_desc, art_type: str) -> bool:
        """Validate that the artifact matches expected filename patterns."""
        blob_name_lower = artifact_desc.blob_name.lower()
        
        if art_type == "finalassessment":
            # Must start with final_assessment_ and end with .json
            return blob_name_lower.startswith("final_assessment_") and blob_name_lower.endswith(".json")
        
        if art_type == "dockerinspect":
            # Must end with docker-inspect.json
            return blob_name_lower.endswith("docker-inspect.json")
        
        if art_type == "codeql":
            # Must end with codeql.sarif
            return blob_name_lower.endswith("codeql.sarif")
        
        if art_type == "sonarqube":
            # Must end with sonarqube_scan.json
            return blob_name_lower.endswith("sonarqube_scan.json")
        
        if art_type == "trivy":
            # Prefer trivy-report.json or trivy-results.sarif
            return blob_name_lower.endswith(("trivy-report.json", "trivy-results.sarif", ".json", ".sarif"))
        
        # For other types (sbom, run, appdesign), accept any non-binary file
        return not blob_name_lower.endswith((".tar.gz", ".zip", ".tgz"))
    
    # Validate the selected artifact matches expected patterns
    if not validate_artifact_pattern(descriptor, artifact_type):
        logger.warning(
            "Selected artifact '%s' (type '%s') does not match expected pattern for run '%s' project '%s'",
            descriptor.blob_name, artifact_type, run_id, project_id
        )
        raise HTTPException(
            status_code=404,
            detail=f"Artifact '{artifact_type}' with expected pattern not found for run '{run_id}'. Found: {descriptor.blob_name}"
        )
    
    # Option 3: Improved error handling with specific error messages
    try:
        if artifact_type == "appdesign":
            try:
                text = catalog.fetch_artifact_text(descriptor)
                return {"content": text}
            except RepositoryError as exc:
                logger.exception("Failed to download artifact '%s' (type '%s') for project '%s' run '%s'", descriptor.blob_name, artifact_type, project_id, run_id)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to download artifact '{descriptor.blob_name}': {str(exc)}"
                ) from exc
        
        # For JSON-based artifacts, attempt to fetch and parse
        try:
            return catalog.fetch_artifact(descriptor)
        except RepositoryError as exc:
            error_msg = str(exc)
            # Check if it's a download failure or JSON parsing failure
            if "Failed to download" in error_msg or "download" in error_msg.lower():
                logger.exception("Failed to download artifact '%s' (type '%s') for project '%s' run '%s'", descriptor.blob_name, artifact_type, project_id, run_id)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to download artifact '{descriptor.blob_name}': {error_msg}"
                ) from exc
            elif "not valid JSON" in error_msg or "json" in error_msg.lower():
                logger.exception("Artifact '%s' (type '%s') is not valid JSON for project '%s' run '%s'", descriptor.blob_name, artifact_type, project_id, run_id)
                raise HTTPException(
                    status_code=500,
                    detail=f"Artifact '{descriptor.blob_name}' is not valid JSON: {error_msg}"
                ) from exc
            else:
                # Generic RepositoryError
                logger.exception("Failed to fetch artifact '%s' (type '%s') for project '%s' run '%s'", descriptor.blob_name, artifact_type, project_id, run_id)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to fetch artifact '{descriptor.blob_name}': {error_msg}"
                ) from exc
    except HTTPException:
        # Re-raise HTTPExceptions as-is
        raise
    except Exception as exc:
        # Catch any unexpected errors
        logger.exception("Unexpected error fetching artifact '%s' (type '%s') for project '%s' run '%s'", descriptor.blob_name, artifact_type, project_id, run_id)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error while fetching artifact '{descriptor.blob_name}': {str(exc)}"
        ) from exc
