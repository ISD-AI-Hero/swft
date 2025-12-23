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
                project, run_id, artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                if project != project_id: continue
                descriptor = ArtifactDescriptor(project_id=project, run_id=run_id, artifact_type="run", blob_name=record.name, container=self._settings.storage.container_runs, last_modified=record.last_modified, size_bytes=record.size)
                artifacts_by_run[run_id].append(descriptor)
            for container, artifact_type in (
                (self._settings.storage.container_sboms, "sbom"),
                (self._settings.storage.container_scans, "trivy"),
                (self._settings.storage.container_appdesign, "appdesign"),
            ):
                for record in self._list_container(container, required=False):
                    project, run_id, artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                    if project != project_id: continue
                    descriptor = ArtifactDescriptor(project_id=project, run_id=run_id, artifact_type=artifact_type, blob_name=record.name, container=container, last_modified=record.last_modified, size_bytes=record.size)
                    # Store descriptors even when we can't immediately load the payload; downstream lookups handle errors.
                    artifacts_by_run[run_id].append(descriptor)
            summaries: list[RunSummary] = []
            for run_id, descriptors in artifacts_by_run.items():
                metadata = self._safe_load_run(project_id, run_id)
                sbom_components = self._sbom_component_total(descriptors)
                summary = RunSummary(
                    project_id=project_id,
                    run_id=run_id,
                    created_at=_coerce_datetime(metadata.get("createdAt")),
                    artifact_counts=_count_by_type(descriptors),
                    sbom_component_total=sbom_components,
                    cosign_status=_nested_str(metadata, ["assessment", "cosign", "verifyStatus"]),
                    trivy_findings_total=_nested_int(metadata, ["assessment", "trivy", "findings", "total"]),
                    trivy_findings_failset=_nested_int(metadata, ["assessment", "trivy", "findings", "failSet"]),
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
                deployment_url=_nested_str(metadata, ["deployment", "aci", "url"])
            )
            return RunDetail(summary=summary, artifacts=descriptors, metadata=metadata)
        return self._cache_get(key, loader)  # type: ignore[return-value]

    def fetch_artifact(self, descriptor: ArtifactDescriptor) -> dict[str, object]:
        """Load and parse an artifact JSON payload from storage."""
        raw = self._repository.download_text(descriptor.container, descriptor.blob_name)
        try:
            return _loads_json(raw.encode("utf-8"))
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

    def _collect_artifacts(self, project_id: str, run_id: str) -> list[ArtifactDescriptor]:
        """Gather all known artifact descriptors for the requested run."""
        descriptors: list[ArtifactDescriptor] = []
        for container, artifact_type in (
            (self._settings.storage.container_runs, "run"),
            (self._settings.storage.container_sboms, "sbom"),
            (self._settings.storage.container_scans, "trivy"),
            (self._settings.storage.container_appdesign, "appdesign"),
        ):
            required = artifact_type == "run"
            # Containers are flat, so we filter by project/run prefix to avoid loading unrelated blobs.
            for record in self._list_container(container, required=required):
                project, record_run_id, _artifact = parse_blob_key(record.name, self._settings.storage.delimiter)
                if project == project_id and record_run_id == run_id:
                    descriptors.append(ArtifactDescriptor(project_id=project_id, run_id=run_id, artifact_type=artifact_type, blob_name=record.name, container=container, last_modified=record.last_modified, size_bytes=record.size))
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

    # final_assessment_<project>_<run>.json
    if blob_name.startswith("final_assessment_") and blob_name.endswith(".json"):
        rest = blob_name[len("final_assessment_"):-len(".json")]
        if "_" not in rest:
            raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern.")
        project, run_id = rest.rsplit("_", 1)
        return project, run_id, "final_assessment.json"

    # Strip signature suffix if present
    is_sig = blob_name.endswith(".sig")
    base_name = blob_name[:-4] if is_sig else blob_name

    #  <project>_<run>_<artifact>.json  (sonarqube + others)
    if base_name.endswith(".json") and "_" in base_name:
        base = base_name[:-len(".json")]
        parts = base.split("_")
        if len(parts) >= 3:
            project = parts[0]
            run_id = parts[1]
            artifact = "_".join(parts[2:]) + ".json"
            return project, run_id, artifact

    # 3canonical delimiter-based format
    parts = base_name.split(delimiter)
    if len(parts) < 3:
        raise RepositoryError(f"Blob name '{blob_name}' does not match expected pattern.")

    project = delimiter.join(parts[:-2])
    run_id = parts[-2]
    artifact = parts[-1]
    return project, run_id, artifact


def build_blob_name(project_id: str, run_id: str, artifact_file: str, delimiter: str) -> str: return f"{project_id}{delimiter}{run_id}{delimiter}{artifact_file}"


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
    """Return a histogram of artifact types for the provided descriptors."""
    counts: dict[str, int] = defaultdict(int)
    for descriptor in descriptors:
        counts[descriptor.artifact_type] += 1
    return dict(counts)
