from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Body
from pydantic import BaseModel

from ...models.swft import (
    CatalogSyncResponse,
    PolicyImportResponse,
    PolicyStateResponse,
    SwftProjectModel,
    SwftProjectUpdate,
    SwftParameterModel,
    EvidenceIngestResponse,
    StorageEvidenceResponse,
    AzurePolicySetModel,
    AzurePolicyImportRequest,
)
from ...services.swft import SwftComplianceService, get_swft_service
from ...services.azure_services import get_azure_services
from ...services.azure_regions import get_azure_regions
from ..deps import get_catalog, get_user
from ...core.security import UserContext
from ...services.catalog import ArtifactCatalogService
from ...services.exceptions import NotFoundError
from ...services.azure_policy_sets import list_policy_sets, get_policy_set
from ...services.azure_policy_sets import AzurePolicySet
from swft.compliance.azure.policy_source import AzurePolicySetSource, PolicyDownloadError

router = APIRouter(prefix="/swft", tags=["swft"])


@contextmanager
def _saved_upload(upload: UploadFile) -> Path:
    """Persist an UploadFile to disk for downstream ingestion."""
    suffix = Path(upload.filename or "").suffix
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        upload.file.seek(0)
        shutil.copyfileobj(upload.file, tmp)
        tmp_path = Path(tmp.name)
    try:
        yield tmp_path
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


def _project_model(project_id: str, record) -> SwftProjectModel:
    return SwftProjectModel(
        project_id=project_id,
        services=record.services,
        regions=record.regions,
        boundary_description=record.boundary_description,
    )


def _parameter_model(control_id: str, param) -> SwftParameterModel:
    return SwftParameterModel(
        control_id=control_id,
        param_id=param.param_id,
        label=param.label,
        description=param.description,
        allowed_values=param.values,
        current_value=param.current_value,
    )


def _policy_set_model(policy: AzurePolicySet) -> AzurePolicySetModel:
    return AzurePolicySetModel(
        id=policy.id,
        label=policy.label,
        default_scope=policy.default_scope,
        description=policy.description,
    )


@router.post("/catalog/sync", response_model=CatalogSyncResponse)
async def sync_catalog(
    catalog: UploadFile = File(...),
    baseline: UploadFile = File(...),
    baseline_name: str = Form(...),
    catalog_name: str = Form("sp800-53-r5.2.0"),
    service: SwftComplianceService = Depends(get_swft_service),
) -> CatalogSyncResponse:
    with _saved_upload(catalog) as catalog_path, _saved_upload(baseline) as baseline_path:
        catalog_summary, baseline_summary = service.sync_catalog(
            catalog_path=catalog_path,
            baseline_path=baseline_path,
            baseline_name=baseline_name,
            catalog_name=catalog_name,
        )
    return CatalogSyncResponse(catalog=catalog_summary, baseline=baseline_summary)


@router.post("/policy/initiatives", response_model=PolicyImportResponse)
async def import_policy_initiative(
    file: UploadFile = File(...),
    name: str = Form(...),
    scope: str = Form("commercial"),
    service: SwftComplianceService = Depends(get_swft_service),
) -> PolicyImportResponse:
    with _saved_upload(file) as path:
        try:
            result = service.import_policy_initiative(file_path=path, name=name, scope=scope)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PolicyImportResponse(**result)


@router.post("/policy/states", response_model=PolicyStateResponse)
async def import_policy_states(
    file: UploadFile = File(...),
    initiative: str = Form(...),
    scope: str = Form("commercial"),
    service: SwftComplianceService = Depends(get_swft_service),
) -> PolicyStateResponse:
    with _saved_upload(file) as path:
        try:
            result = service.import_policy_states(file_path=path, initiative=initiative, scope=scope)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PolicyStateResponse(**result)


@router.get("/policy/builtins", response_model=list[AzurePolicySetModel])
def list_builtin_policies() -> list[AzurePolicySetModel]:
    return [_policy_set_model(policy) for policy in list_policy_sets()]


@router.post("/policy/builtins", response_model=PolicyImportResponse)
def import_builtin_policy(
    payload: AzurePolicyImportRequest,
    service: SwftComplianceService = Depends(get_swft_service),
) -> PolicyImportResponse:
    policy = get_policy_set(payload.policy_id)
    if policy is None:
        raise HTTPException(status_code=404, detail=f"Unknown policy set '{payload.policy_id}'.")
    source = AzurePolicySetSource()
    try:
        data = source.fetch(policy.filename)
    except PolicyDownloadError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    scope = payload.scope or policy.default_scope
    with NamedTemporaryFile(delete=False, suffix=".json") as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        result = service.import_policy_initiative(file_path=tmp_path, name=policy.id, scope=scope)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
    return PolicyImportResponse(**result)


@router.get("/{project_id}/project", response_model=SwftProjectModel)
def fetch_project(
    project_id: str,
    service: SwftComplianceService = Depends(get_swft_service),
) -> SwftProjectModel:
    try:
        record = service.get_project(project_key=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _project_model(project_id, record)


@router.put("/{project_id}/project", response_model=SwftProjectModel)
def upsert_project(
    project_id: str,
    payload: SwftProjectUpdate,
    service: SwftComplianceService = Depends(get_swft_service),
) -> SwftProjectModel:
    record = service.upsert_project(
        project_key=project_id,
        services=payload.services,
        regions=payload.regions,
        boundary=payload.boundary_description,
    )
    return _project_model(project_id, record)


@router.get("/{project_id}/controls/{control_id}/parameters", response_model=list[SwftParameterModel])
def list_control_parameters(
    project_id: str,
    control_id: str,
    service: SwftComplianceService = Depends(get_swft_service),
) -> list[SwftParameterModel]:
    try:
        params = service.list_parameters(project_key=project_id, control_id=control_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [_parameter_model(control_id, param) for param in params]


class ParameterUpdate(BaseModel):
    value: str


class StorageIngestRequest(BaseModel):
    kinds: list[str] | None = None


@router.put("/{project_id}/controls/{control_id}/parameters/{param_id}")
def set_parameter_value(
    project_id: str,
    control_id: str,
    param_id: str,
    payload: ParameterUpdate,
    service: SwftComplianceService = Depends(get_swft_service),
) -> dict:
    try:
        service.set_parameter(
            project_key=project_id,
            control_id=control_id,
            param_id=param_id,
            value=payload.value,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/{project_id}/runs/{run_id}/evidence/sbom", response_model=EvidenceIngestResponse)
async def upload_sbom(
    project_id: str,
    run_id: str,
    file: UploadFile = File(...),
    service: SwftComplianceService = Depends(get_swft_service),
) -> EvidenceIngestResponse:
    with _saved_upload(file) as path:
        try:
            result = service.ingest_sbom(project_key=project_id, run_id=run_id, sbom_path=path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EvidenceIngestResponse(evidence_id=result["evidence_id"], run_id=result["run_id"], kind="sbom", metadata={"components": result["components"]})


@router.post("/{project_id}/runs/{run_id}/evidence/trivy", response_model=EvidenceIngestResponse)
async def upload_trivy(
    project_id: str,
    run_id: str,
    file: UploadFile = File(...),
    artifact_hint: str | None = Form(default=None),
    service: SwftComplianceService = Depends(get_swft_service),
) -> EvidenceIngestResponse:
    with _saved_upload(file) as path:
        try:
            result = service.ingest_trivy(project_key=project_id, run_id=run_id, report_path=path, artifact_hint=artifact_hint)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EvidenceIngestResponse(
        evidence_id=result["evidence_id"],
        run_id=result["run_id"],
        kind="trivy",
        metadata={"findings": result["findings"]},
    )


@router.post("/{project_id}/runs/{run_id}/evidence/signature", response_model=EvidenceIngestResponse)
async def upload_signature(
    project_id: str,
    run_id: str,
    file: UploadFile = File(...),
    digest: str = Form(...),
    verified: bool = Form(...),
    service: SwftComplianceService = Depends(get_swft_service),
) -> EvidenceIngestResponse:
    with _saved_upload(file) as path:
        try:
            result = service.ingest_signature(project_key=project_id, run_id=run_id, signature_path=path, digest=digest, verified=verified)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EvidenceIngestResponse(
        evidence_id=result["evidence_id"],
        run_id=result["run_id"],
        kind="signature",
        metadata={"verified": result["verified"], "digest": digest},
    )


@router.post("/{project_id}/runs/{run_id}/evidence/from-storage", response_model=StorageEvidenceResponse)
def ingest_evidence_from_storage(
    project_id: str,
    run_id: str,
    payload: StorageIngestRequest | None = Body(default=None),
    service: SwftComplianceService = Depends(get_swft_service),
    catalog: ArtifactCatalogService = Depends(get_catalog),
) -> StorageEvidenceResponse:
    kinds = payload.kinds if payload else None
    try:
        results = service.ingest_evidence_from_storage(project_key=project_id, run_id=run_id, catalog=catalog, kinds=kinds)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StorageEvidenceResponse(project_id=project_id, run_id=run_id, results=results)
@router.get("/services", response_model=list[str])
def list_services() -> list[str]:
    """Return the curated list of Azure services."""
    services = get_azure_services()
    if not services:
        raise HTTPException(status_code=500, detail="Azure services catalog unavailable.")
    return services


@router.get("/regions", response_model=list[str])
def list_regions() -> list[str]:
    regions = get_azure_regions()
    if not regions:
        raise HTTPException(status_code=500, detail="Azure regions catalog unavailable.")
    return regions
