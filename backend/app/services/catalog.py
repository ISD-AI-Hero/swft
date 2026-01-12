from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Callable, Iterable, Sequence
import logging

try:
    import orjson as _orjson
    def _loads_json(payload: bytes) -> dict[str, object]: return _orjson.loads(payload)
except ModuleNotFoundError:
    import json as _json
    def _loads_json(payload: bytes) -> dict[str, object]: return _json.loads(payload.decode("utf-8"))

from ..core.config import AppSettings
from ..core.cache import create_cache
from ..models.domain import ArtifactDescriptor, ProjectSummary, RunDetail, RunSummary
from .exceptions import NotFoundError, RepositoryError
from .repository import BlobRecord, BlobRepository, AzureBlobRepository, LocalBlobRepository

RUN_ARTIFACT_NAME = "run.json"
SBOM_ARTIFACT_NAME = "sbom.json"
TRIVY_ARTIFACT_NAME = "trivy.json"
APPDESIGN_ARTIFACT_NAME = "appdesign.md"

logger = logging.getLogger(__name__)

class ArtifactCatalogService:
    def __init__(self, repository: BlobRepository, settings: AppSettings):
        self._repository = repository
        self._settings = settings
        # The TTL cache keeps recently accessed run metadata warm so repeated UI calls avoid blob round-trips.
        self._cache = create_cache(settings.cache_max_items, settings.cache_ttl_seconds)

    def _cache_get(self, key: str, loader: Callable[[], object]) -> object:
        """Fetch a value from the TTL cache, invoking loader if the key is missing."""
        if key in self._cache: return self._cache[key]
        value = loader()
        self._cache[key] = value
        return value

    def _list_container(self, container: str, *, required: bool) -> Sequence[BlobRecord]:
        """List blobs from a container, optionally tolerating missing containers."""
        if not container:
            return []
        try:
            return list(self._repository.list_blobs(container))
        except RepositoryError as exc:
            if required:
                raise
            logger.debug("Optional container '%s' unavailable (%s); continuing without it.", container, exc)
            return []

    def list_projects(self) -> Sequence[ProjectSummary]:
        """Return summaries of all projects discovered via run manifests."""
        key = "projects"
        def loader() -> Sequence[ProjectSummary]:
            groups: dict[str, list[datetime | None]] = defaultdict(list)
            for record in self._list_container(self._settings.storage.container_runs, required=True):
                logger.info("Parsing blob name: %s", record.name)
                project_id, _run_id, _artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                if record.last_modified:
                    groups[project_id].append(record.last_modified)
                else:
                    groups[project_id].append(None)
            summaries: list[ProjectSummary] = []
            for project_id, timestamps in groups.items():
                latest = max((ts for ts in timestamps if ts is not None), default=None)
                summaries.append(ProjectSummary(project_id=project_id, run_count=len(timestamps), latest_run_at=latest))
            summaries.sort(key=lambda item: item.project_id)
            return summaries
        return self._cache_get(key, loader)  # type: ignore[return-value]

    def list_runs(self, project_id: str, limit: int | None = None) -> Sequence[RunSummary]:
        """List run summaries for a given project, optionally capped to the most recent N results.

        When ``limit`` is provided it is expected to be a small positive integer (validated upstream).
        The summaries are ordered newest-first and include derived SBOM and Trivy metadata needed by the UI.
        """
        capped = limit if isinstance(limit, int) and limit > 0 else None
        key = f"runs:{project_id}:{capped or 'all'}"
        def loader() -> Sequence[RunSummary]:
            runs: dict[str, RunSummary] = {}
            artifacts_by_run: dict[str, list[ArtifactDescriptor]] = defaultdict(list)
            # Sweep the run container first so we know which run IDs exist before looking for SBOM/Trivy extras.
            for record in self._list_container(self._settings.storage.container_runs, required=True):
                logger.info(f"Parsing blob name: {record.name}")
                try:
                    project, run_id, artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                except RepositoryError as exc:
                    logger.debug("Skipping blob '%s' in container '%s': %s", record.name, self._settings.storage.container_runs, exc)
                    continue
                if project != project_id: continue
                descriptor = ArtifactDescriptor(project_id=project, run_id=run_id, artifact_type="run", blob_name=record.name, container=self._settings.storage.container_runs, last_modified=record.last_modified, size_bytes=record.size)
                artifacts_by_run[run_id].append(descriptor)
            # Handle containers with fixed artifact types
            for container, artifact_type in (
                (self._settings.storage.container_sboms, "sbom"),
                (self._settings.storage.container_appdesign, "appdesign"),
            ):
                for record in self._list_container(container, required=False):
                    try:
                        project, run_id, artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                    except RepositoryError as exc:
                        logger.debug("Skipping blob '%s' in container '%s': %s", record.name, container, exc)
                        continue
                    if project != project_id: continue
                    descriptor = ArtifactDescriptor(project_id=project, run_id=run_id, artifact_type=artifact_type, blob_name=record.name, container=container, last_modified=record.last_modified, size_bytes=record.size)
                    # Store descriptors even when we can't immediately load the payload; downstream lookups handle errors.
                    artifacts_by_run[run_id].append(descriptor)
            
            # Handle container_scans separately with dynamic type detection
            for record in self._list_container(self._settings.storage.container_scans, required=False):
                try:
                    project, run_id, artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                except RepositoryError as exc:
                    logger.debug("Skipping blob '%s' in container '%s': %s", record.name, self._settings.storage.container_scans, exc)
                    continue
                if project != project_id: continue
                # Detect artifact type from filename
                detected_type = _detect_scan_artifact_type(record.name)
                descriptor = ArtifactDescriptor(project_id=project, run_id=run_id, artifact_type=detected_type, blob_name=record.name, container=self._settings.storage.container_scans, last_modified=record.last_modified, size_bytes=record.size)
                # Store descriptors even when we can't immediately load the payload; downstream lookups handle errors.
                artifacts_by_run[run_id].append(descriptor)
            summaries: list[RunSummary] = []
            for run_id, descriptors in artifacts_by_run.items():
                metadata = self._safe_load_run(project_id, run_id)
                sbom_components = self._sbom_component_total(descriptors)
                final_assessment_total, final_assessment_failset = self._final_assessment_findings(descriptors, metadata)
                final_assessment_overall_risk_level = self._final_assessment_overall_risk_level(descriptors)
                summary = RunSummary(
                    project_id=project_id,
                    run_id=run_id,
                    created_at=_coerce_datetime(metadata.get("createdAt")),
                    artifact_counts=_count_by_type(descriptors),
                    sbom_component_total=sbom_components,
                    cosign_status=_nested_str(metadata, ["assessment", "cosign", "verifyStatus"]),
                    trivy_findings_total=_nested_int(metadata, ["assessment", "trivy", "findings", "total"]),
                    trivy_findings_failset=_nested_int(metadata, ["assessment", "trivy", "findings", "failSet"]),
                    final_assessment_findings_total=final_assessment_total,
                    final_assessment_findings_failset=final_assessment_failset,
                    final_assessment_overall_risk_level=final_assessment_overall_risk_level,
                    deployment_url=_nested_str(metadata, ["deployment", "aci", "url"])
                )
                runs[run_id] = summary
            fallback = datetime.min.replace(tzinfo=timezone.utc)
            ordered = sorted(runs.values(), key=lambda item: item.created_at or fallback, reverse=True)
            return ordered[:capped] if capped else ordered
        return self._cache_get(key, loader)  # type: ignore[return-value]

    def run_detail(self, project_id: str, run_id: str) -> RunDetail:
        """Return detailed metadata and artifact descriptors for a specific run."""
        key = f"run-detail:{project_id}:{run_id}"
        def loader() -> RunDetail:
            metadata = self._load_run_metadata(project_id, run_id)
            descriptors = self._collect_artifacts(project_id, run_id)
            sbom_components = self._sbom_component_total(descriptors)
            final_assessment_total, final_assessment_failset = self._final_assessment_findings(descriptors, metadata)
            final_assessment_overall_risk_level = self._final_assessment_overall_risk_level(descriptors)
            # Summaries mirror list_runs so the UI can render detail and list views interchangeably.
            summary = RunSummary(
                project_id=project_id,
                run_id=run_id,
                created_at=_coerce_datetime(metadata.get("createdAt")),
                artifact_counts=_count_by_type(descriptors),
                sbom_component_total=sbom_components,
                cosign_status=_nested_str(metadata, ["assessment", "cosign", "verifyStatus"]),
                trivy_findings_total=_nested_int(metadata, ["assessment", "trivy", "findings", "total"]),
                trivy_findings_failset=_nested_int(metadata, ["assessment", "trivy", "findings", "failSet"]),
                final_assessment_findings_total=final_assessment_total,
                final_assessment_findings_failset=final_assessment_failset,
                final_assessment_overall_risk_level=final_assessment_overall_risk_level,
                deployment_url=_nested_str(metadata, ["deployment", "aci", "url"])
            )
            return RunDetail(summary=summary, artifacts=descriptors, metadata=metadata)
        return self._cache_get(key, loader)  # type: ignore[return-value]

    def fetch_artifact(self, descriptor: ArtifactDescriptor) -> dict[str, object] | list[dict[str, object]]:
        """Load and parse an artifact JSON payload from storage.
        
        Returns either a dict or list of dicts, depending on the artifact format.
        For example, docker inspect can return either a single object or an array.
        """
        raw = self._repository.download_text(descriptor.container, descriptor.blob_name)
        try:
            # JSON can be either a dict or list - both are valid
            parsed = _loads_json(raw.encode("utf-8"))
            # Type check: ensure it's either dict or list of dicts
            if isinstance(parsed, list):
                return parsed  # type: ignore[return-value]
            elif isinstance(parsed, dict):
                return parsed  # type: ignore[return-value]
            else:
                raise RepositoryError(f"Artifact '{descriptor.blob_name}' contains invalid JSON structure (expected dict or list of dicts).")
        except RepositoryError:
            raise
        except Exception as exc:
            raise RepositoryError(f"Artifact '{descriptor.blob_name}' is not valid JSON.") from exc

    def _sbom_component_total(self, descriptors: Sequence[ArtifactDescriptor]) -> int | None:
        """Count the number of components in the first SBOM artifact, if present."""
        for descriptor in descriptors:
            if descriptor.artifact_type != "sbom":
                continue
            try:
                payload = self.fetch_artifact(descriptor)
            except RepositoryError:
                # Skip corrupt SBOMs: the detail view will surface fetch errors separately.
                continue
            components = payload.get("components")
            if isinstance(components, list):
                return len(components)
        return None

    def _final_assessment_findings(self, descriptors: Sequence[ArtifactDescriptor], metadata: dict[str, object]) -> tuple[int | None, int | None]:
        """
        [FINAL_ASSESSMENT_FINDINGS_TEMP] Extract final assessment findings counts.
        
        TODO: Future development should pull this information from the run.json artifact
        instead of parsing the final_assessment artifact file. For now, this logic pulls
        from the final_assessment artifact.
        
        Returns: (total_findings, failset_findings) tuple, both None if artifact doesn't exist.
        """
        # Find final_assessment artifact (exclude .sig files)
        final_assessment_descriptor = None
        for descriptor in descriptors:
            if descriptor.artifact_type == "finalassessment" and descriptor.blob_name.endswith(".json") and not descriptor.blob_name.endswith(".json.sig"):
                final_assessment_descriptor = descriptor
                break
        
        if final_assessment_descriptor is None:
            return (None, None)
        
        # Try to fetch and parse the artifact
        try:
            payload = self.fetch_artifact(final_assessment_descriptor)
        except RepositoryError as exc:
            logger.debug("Failed to fetch final_assessment artifact '%s' for run: %s", final_assessment_descriptor.blob_name, exc)
            return (None, None)
        
        # Ensure payload is a dict (not a list)
        if not isinstance(payload, dict):
            logger.warning("Final assessment artifact '%s' contains invalid structure (expected dict, got %s)", final_assessment_descriptor.blob_name, type(payload).__name__)
            return (None, None)
        
        # Extract Vulnerabilities array
        vulnerabilities = payload.get("Vulnerabilities")
        if not isinstance(vulnerabilities, list):
            logger.warning("Final assessment artifact '%s' missing or invalid Vulnerabilities array", final_assessment_descriptor.blob_name)
            return (None, None)
        
        # Count total findings
        total_findings = len(vulnerabilities)
        
        # [FINAL_ASSESSMENT_FAILSET_TEMP] Extract failSeverities from trivy section
        # TODO: This logic is temporarily looking at metadata["assessment"]["trivy"]["failSeverities"]
        # even though the data is from final_assessment. Future changes to run.json artifact should
        # move failSeverities to a final_assessment section.
        failset_findings: int | None = None
        
        try:
            # Navigate to failSeverities in metadata
            trivy_section = metadata.get("assessment")
            if isinstance(trivy_section, dict):
                trivy_data = trivy_section.get("trivy")
                if isinstance(trivy_data, dict):
                    fail_severities_str = trivy_data.get("failSeverities")
                    
                    if isinstance(fail_severities_str, str) and fail_severities_str:
                        # Split comma-delimited string and normalize to uppercase
                        fail_severities_set = {severity.strip().upper() for severity in fail_severities_str.split(",")}
                        
                        # Count vulnerabilities where RiskLevel (normalized to uppercase) is in failSeverities set
                        failset_count = 0
                        for vuln in vulnerabilities:
                            if not isinstance(vuln, dict):
                                continue
                            risk_level = vuln.get("RiskLevel")
                            if isinstance(risk_level, str):
                                risk_level_upper = risk_level.strip().upper()
                                if risk_level_upper in fail_severities_set:
                                    failset_count += 1
                        
                        failset_findings = failset_count
                    else:
                        logger.debug("failSeverities not found or invalid in run.json for run, cannot calculate failset")
                else:
                    logger.debug("trivy section not found in assessment metadata, cannot calculate failset")
            else:
                logger.debug("assessment section not found in metadata, cannot calculate failset")
        except Exception as exc:
            logger.debug("Error extracting failSeverities from metadata: %s", exc)
        
        return (total_findings, failset_findings)

    def _final_assessment_overall_risk_level(self, descriptors: Sequence[ArtifactDescriptor]) -> str | None:
        """
        Extract the RiskLevel field from the root of final_assessment artifact.
        
        Returns the RiskLevel value (CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN) from the root of the JSON,
        normalized to uppercase, or None if artifact doesn't exist or field is missing.
        """
        # Find final_assessment artifact (exclude .sig files)
        final_assessment_descriptor = None
        for descriptor in descriptors:
            if descriptor.artifact_type == "finalassessment" and descriptor.blob_name.endswith(".json") and not descriptor.blob_name.endswith(".json.sig"):
                final_assessment_descriptor = descriptor
                break
        
        if final_assessment_descriptor is None:
            return None
        
        # Try to fetch and parse the artifact
        try:
            payload = self.fetch_artifact(final_assessment_descriptor)
        except RepositoryError as exc:
            logger.debug("Failed to fetch final_assessment artifact '%s' for overall risk level: %s", final_assessment_descriptor.blob_name, exc)
            return None
        
        # Ensure payload is a dict (not a list)
        if not isinstance(payload, dict):
            logger.warning("Final assessment artifact '%s' contains invalid structure for overall risk level (expected dict, got %s)", final_assessment_descriptor.blob_name, type(payload).__name__)
            return None
        
        # Extract RiskLevel from root of JSON
        risk_level = payload.get("RiskLevel")
        if isinstance(risk_level, str):
            # Normalize to uppercase
            return risk_level.strip().upper()
        
        return None

    def _collect_artifacts(self, project_id: str, run_id: str) -> list[ArtifactDescriptor]:
        """Gather all known artifact descriptors for the requested run."""
        descriptors: list[ArtifactDescriptor] = []
        # Handle containers with fixed artifact types
        for container, artifact_type in (
            (self._settings.storage.container_runs, "run"),
            (self._settings.storage.container_sboms, "sbom"),
            (self._settings.storage.container_appdesign, "appdesign"),
        ):
            required = artifact_type == "run"
            # Containers are flat, so we filter by project/run prefix to avoid loading unrelated blobs.
            # Since we know project_id and run_id, we can use the simpler extraction function.
            for record in self._list_container(container, required=required):
                try:
                    # Try to extract artifact - this validates the blob matches our project/run
                    _artifact = extract_artifact_from_blob_name(record.name, project_id, run_id, self._settings.storage.delimiter)
                    descriptors.append(ArtifactDescriptor(project_id=project_id, run_id=run_id, artifact_type=artifact_type, blob_name=record.name, container=container, last_modified=record.last_modified, size_bytes=record.size))
                except RepositoryError:
                    # Blob doesn't match this project/run, skip it
                    continue
        
        # Handle container_scans separately with dynamic type detection
        for record in self._list_container(self._settings.storage.container_scans, required=False):
            try:
                # Validate blob matches our project/run
                _artifact = extract_artifact_from_blob_name(record.name, project_id, run_id, self._settings.storage.delimiter)
                # Detect artifact type from filename
                detected_type = _detect_scan_artifact_type(record.name)
                descriptors.append(ArtifactDescriptor(project_id=project_id, run_id=run_id, artifact_type=detected_type, blob_name=record.name, container=self._settings.storage.container_scans, last_modified=record.last_modified, size_bytes=record.size))
            except RepositoryError:
                # Blob doesn't match this project/run, skip it
                continue
        
        if not descriptors:
            raise NotFoundError(f"No artifacts found for project '{project_id}' run '{run_id}'.")
        return descriptors

    def fetch_artifact_text(self, descriptor: ArtifactDescriptor) -> str:
        """Return the raw text content of an artifact."""
        try:
            return self._repository.download_text(descriptor.container, descriptor.blob_name)
        except RepositoryError:
            raise
        except Exception as exc:
            raise RepositoryError(f"Failed to download '{descriptor.blob_name}'.") from exc

    def _load_run_metadata(self, project_id: str, run_id: str) -> dict[str, object]:
        """Read the canonical run.json metadata file for the run."""
        blob_name = build_blob_name(project_id, run_id, RUN_ARTIFACT_NAME, self._settings.storage.delimiter)
        try:
            raw = self._repository.download_text(self._settings.storage.container_runs, blob_name)
        except RepositoryError as exc:
            raise NotFoundError(f"Run manifest for project '{project_id}' run '{run_id}' not found.") from exc
        try:
            return _loads_json(raw.encode("utf-8"))
        except Exception as exc:
            raise RepositoryError(f"Run metadata for '{project_id}:{run_id}' is not valid JSON.") from exc

    def _safe_load_run(self, project_id: str, run_id: str) -> dict[str, object]:
        """Attempt to load run metadata, returning an empty dict on failure."""
        try:
            return self._load_run_metadata(project_id, run_id)
        except (NotFoundError, RepositoryError):
            return {}

    def load_app_design(self, project_id: str, run_id: str) -> str | None:
        """Return the per-run app-design.md contents if available."""
        container = self._settings.storage.container_appdesign
        if not container:
            return None

        key = f"appdesign:{project_id}:{run_id}"

        def loader() -> str | None:
            metadata = self._safe_load_run(project_id, run_id)
            file_name = _nested_str(metadata, ["artifacts", "files", "appDesign"])
            if not file_name:
                file_name = build_blob_name(project_id, run_id, APPDESIGN_ARTIFACT_NAME, self._settings.storage.delimiter)
            try:
                return self._repository.download_text(container, file_name)
            except RepositoryError:
                return None

        result = self._cache_get(key, loader)
        return result if isinstance(result, str) else None


def create_catalog(settings: AppSettings) -> ArtifactCatalogService:
    """Factory that picks the appropriate repository implementation."""
    repository: BlobRepository
    if settings.storage.local_blob_root:
        repository = LocalBlobRepository(settings.storage.local_blob_root)
    else:
        repository = AzureBlobRepository(settings.storage, settings.auth)
    return ArtifactCatalogService(repository, settings)


def parse_blob_key(blob_name: str, delimiter: str) -> tuple[str, str, str]:
    """Split a blob name into project, run, and artifact segments."""

    # Support legacy "final_assessment_<project>_<run>.json(.sig)" naming

    # final_assessment_<project>_<run>.json or final_assessment_<project>_<run>.json.sig
    # Note: Project can contain underscores, so we need to identify the numeric run_id
    # Handle .sig files by checking for the suffix
    is_sig_final = blob_name.endswith(".json.sig")
    
    if blob_name.startswith("final_assessment_") and (blob_name.endswith(".json") or blob_name.endswith(".json.sig")):
        # Remove "final_assessment_" prefix and ".json" or ".json.sig" suffix
        if is_sig_final:
            rest = blob_name[len("final_assessment_"):-len(".json.sig")]
        else:
            rest = blob_name[len("final_assessment_"):-len(".json")]
        
        if "_" not in rest:
            raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern.")
        
        # Find the numeric run_id (typically at the end, but project may contain underscores)
        parts = rest.split("_")
        if len(parts) < 2:
            raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern.")
        
        # Look for numeric run_id, starting from the end.
        # Run_id is always numeric, so we require it to be found.
        run_id_idx = None
        for i in range(len(parts) - 1, 0, -1):  # Check from right to left, skip first segment
            if parts[i].isdigit():
                run_id_idx = i
                break
        
        if run_id_idx is None:
            raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern: no numeric run_id found.")
        
        project = "_".join(parts[:run_id_idx])
        run_id = parts[run_id_idx]
        
        return project, run_id, "final_assessment.json"

    # Strip signature suffix if present
    is_sig = blob_name.endswith(".sig")
    base_name = blob_name[:-4] if is_sig else blob_name

    #  <project>_<run>_<artifact>.json  (sonarqube + others)
    # Note: Both project and artifact can contain underscores, so we need to find the run_id
    # which is numeric (GitHub Actions run ID).
    if base_name.endswith(".json") and "_" in base_name:
        base = base_name[:-len(".json")]
        parts = base.split("_")
        if len(parts) < 3:
            raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern.")
        else:
            # Find the numeric run_id segment. Run_id is always numeric and separates project from artifact.
            # Search from right to left to avoid matching numeric segments in project names.
            run_id_idx = None
            for i in range(len(parts) - 2, 0, -1):  # Check from right to left, can't be first or last segment
                if parts[i].isdigit():
                    run_id_idx = i
                    break
            
            if run_id_idx is None:
                raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern: no numeric run_id found.")
            
            project = "_".join(parts[:run_id_idx])
            run_id = parts[run_id_idx]
            artifact = "_".join(parts[run_id_idx + 1:]) + ".json"
            return project, run_id, artifact

    # Canonical delimiter-based format: <project><delimiter><run_id><delimiter><artifact>
    # Note: Both project and artifact can contain the delimiter, so we need careful parsing.
    # Strategy: The run_id is a numeric segment (GitHub Actions run ID).
    # Work backwards from the end to find the artifact, then identify the run_id as the
    # segment immediately before the artifact. Everything before run_id is the project.
    
    parts = base_name.split(delimiter)
    if len(parts) < 3:
        raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern.")

    # Find where the artifact starts by working backwards.
    # The artifact is the trailing segments that form a valid filename with extension.
    # We need at least 1 segment for project and 1 for run_id, so we need at least 3 total segments.
    # Run_id is always numeric, so we require it.
    
    artifact_start_idx = None
    run_id_idx = None
    
    for i in range(len(parts) - 1, 1, -1):  # i must be at least 2 (need room for run_id and project)
        potential_artifact = delimiter.join(parts[i:])
        # Check if this forms a valid artifact filename (has an extension)
        if "." in potential_artifact and not potential_artifact.startswith("."):
            if i > 1:
                potential_run_id = parts[i - 1]
                # Run_id is always numeric, so we require it
                if potential_run_id.isdigit():
                    artifact_start_idx = i
                    run_id_idx = i - 1
                    break
            # Continue to find a valid artifact with numeric run_id before it
    
    if artifact_start_idx is None or run_id_idx is None:
        raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern: no valid artifact with numeric run_id found.")
    
    # Extract components
    project = delimiter.join(parts[:run_id_idx])
    run_id = parts[run_id_idx]
    artifact = delimiter.join(parts[artifact_start_idx:])
    
    return project, run_id, artifact


def build_blob_name(project_id: str, run_id: str, artifact_file: str, delimiter: str) -> str: return f"{project_id}{delimiter}{run_id}{delimiter}{artifact_file}"


def extract_artifact_from_blob_name(blob_name: str, project_id: str, run_id: str, delimiter: str) -> str:
    """Extract artifact name from blob_name when project_id and run_id are known.
    
    This is much simpler than full parsing since we can match against known prefixes.
    Returns the artifact name, or raises RepositoryError if the blob doesn't match.
    """
    # Strip signature suffix if present
    is_sig = blob_name.endswith(".sig")
    base_name = blob_name[:-4] if is_sig else blob_name
    
    # Check final_assessment format: final_assessment_<project_id>_<run_id>.json
    final_assessment_pattern = f"final_assessment_{project_id}_{run_id}.json"
    if base_name == final_assessment_pattern:
        return "final_assessment.json"
    
    # Check underscore-delimited format: <project_id>_<run_id>_<artifact>
    underscore_prefix = f"{project_id}_{run_id}_"
    if base_name.startswith(underscore_prefix):
        artifact = base_name[len(underscore_prefix):]
        if artifact:  # Must have something after the prefix
            return artifact
    
    # Check delimiter-based format: <project_id><delimiter><run_id><delimiter><artifact>
    delimiter_prefix = f"{project_id}{delimiter}{run_id}{delimiter}"
    if base_name.startswith(delimiter_prefix):
        artifact = base_name[len(delimiter_prefix):]
        if artifact:  # Must have something after the prefix
            return artifact
    
    # No match found
    raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern for project '{project_id}' run '{run_id}'.")


def _detect_scan_artifact_type(blob_name: str) -> str:
    """Detect artifact type from blob name for files in container_scans.
    
    Returns one of: "trivy", "codeql", "sonarqube", "dockerinspect", "finalassessment", "other"
    """
    # Check patterns in priority order (patterns don't depend on file extensions)
    # 1. final_assessment_ prefix (most specific)
    if blob_name.startswith("final_assessment_"):
        return "finalassessment"
    
    # 2. codeql pattern (matches codeql-db.tar.gz and codeql.sarif)
    if "codeql" in blob_name:
        return "codeql"
    
    # 3. sonarqube_scan pattern
    if "sonarqube_scan" in blob_name:
        return "sonarqube"
    
    # 4. docker-inspect pattern
    if "docker-inspect" in blob_name:
        return "dockerinspect"
    
    # 5. trivy patterns
    if "trivy-report" in blob_name or "trivy-results" in blob_name:
        return "trivy"
    
    # 6. Unrecognized pattern - default to "other" and log warning
    logger.debug("Unrecognized artifact pattern in blob '%s': does not match expected scan artifact types", blob_name)
    return "other"


def _coerce_datetime(value: object) -> datetime | None:
    """Normalise various datetime string/object inputs to timezone-aware UTC."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _nested_str(data: dict[str, object], path: Iterable[str]) -> str | None:
    """Walk a JSON dictionary and return a leaf value as a string."""
    current: object = data
    for key in path:
        if not isinstance(current, dict): return None
        current = current.get(key)
    return current if isinstance(current, str) else None


def _nested_int(data: dict[str, object], path: Iterable[str]) -> int | None:
    """Walk a JSON dictionary and coerce the leaf value to an integer when possible."""
    current: object = data
    for key in path:
        if not isinstance(current, dict): return None
        current = current.get(key)
    if isinstance(current, int): return current
    if isinstance(current, str):
        try:
            return int(current)
        except ValueError:
            return None
    return None


def _count_by_type(descriptors: Sequence[ArtifactDescriptor]) -> dict[str, int]:
    """Return a histogram of artifact types for the provided descriptors, excluding .sig files."""
    counts: dict[str, int] = defaultdict(int)
    for descriptor in descriptors:
        # Exclude .sig files from counts
        if not descriptor.blob_name.endswith(".sig"):
            counts[descriptor.artifact_type] += 1
    return dict(counts)
