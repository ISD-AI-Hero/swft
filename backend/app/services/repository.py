from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Protocol, TYPE_CHECKING, Any
from importlib import import_module
from .exceptions import RepositoryError
from ..core.config import StorageSettings, AzureAuthSettings
import os
import pathlib

try:
    AzureIdentityModule = import_module("azure.identity")
    AzureStorageModule = import_module("azure.storage.blob")
except ModuleNotFoundError:
    AzureIdentityModule = None
    AzureStorageModule = None

if TYPE_CHECKING:
    from azure.storage.blob import ContainerClient as AzureContainerClient
else:
    AzureContainerClient = Any


@dataclass(frozen=True, slots=True)
class BlobRecord:
    container: str
    name: str
    last_modified: datetime | None
    size: int | None


class BlobRepository(Protocol):
    def list_blobs(self, container: str) -> Iterable[BlobRecord]: ...
    def download_text(self, container: str, blob_name: str) -> str: ...


def _build_credential(settings: AzureAuthSettings):
    """Create an Azure identity credential from client-secret settings or fall back to DefaultAzureCredential."""
    if settings.client_id and settings.client_secret and settings.tenant_id:
        if AzureIdentityModule is None:
            raise RepositoryError("azure-identity package is required for client secret authentication.")
        ClientSecretCredential = getattr(AzureIdentityModule, "ClientSecretCredential")
        return ClientSecretCredential(tenant_id=settings.tenant_id, client_id=settings.client_id, client_secret=settings.client_secret)
    if AzureIdentityModule is None:
        raise RepositoryError("azure-identity package is required for default credentials.")
    DefaultAzureCredential = getattr(AzureIdentityModule, "DefaultAzureCredential")
    return DefaultAzureCredential(exclude_interactive_browser_credential=True, exclude_powershell_credential=True)


class AzureBlobRepository:
    def __init__(self, storage: StorageSettings, auth: AzureAuthSettings):
        """Initialise a blob repository that talks directly to Azure Storage."""
        if AzureStorageModule is None:
            raise RepositoryError("azure-storage-blob package is required for AzureBlobRepository.")
        try:
            BlobServiceClient = getattr(AzureStorageModule, "BlobServiceClient")
            if storage.connection_string:
                self._client = BlobServiceClient.from_connection_string(storage.connection_string)
                print("Using Blob Service Client")
            elif storage.account_name:
                credential = _build_credential(auth)
                url = f"https://{storage.account_name}.blob.core.usgovcloudapi.net"
                self._client = BlobServiceClient(account_url=url, credential=credential)
            else:
                raise RepositoryError("Missing Azure storage account configuration.")
        except Exception as exc:
            raise RepositoryError("Failed to initialize Azure BlobServiceClient.") from exc

    def _container(self, name: str) -> AzureContainerClient:
        """Return a container client or raise a RepositoryError when the container is inaccessible."""
        try:
            return self._client.get_container_client(name)
        except Exception as exc:
            raise RepositoryError(f"Unable to access container '{name}'.") from exc

    def list_blobs(self, container: str) -> Iterable[BlobRecord]:
        """Yield BlobRecord entries for every blob in the target container."""
        client = self._container(container)
        try:
            # Azure SDK returns a lazy iterator; we mirror that behaviour while normalising fields.
            print("DEBUG container_url =", client.url)
            for blob in client.list_blobs():
                yield BlobRecord(container=container, name=blob.name, last_modified=getattr(blob, "last_modified", None), size=getattr(blob, "size", None))
        except Exception as exc:
            raise RepositoryError(f"Failed listing blobs in container '{container}'.") from exc

    def download_text(self, container: str, blob_name: str) -> str:
        """Download and return the raw text content of a blob."""
        client = self._container(container)
        blob_client = client.get_blob_client(blob_name)
        try:
            return blob_client.download_blob().content_as_text(encoding="utf-8")
        except Exception as exc:
            raise RepositoryError(f"Failed to download '{blob_name}' from '{container}'.") from exc


class LocalBlobRepository:
    def __init__(self, root_path: str):
        """Create a repository that reads blobs from a local directory tree."""
        self._root = pathlib.Path(root_path).expanduser().resolve()
        if not self._root.exists():
            raise RepositoryError(f"Local blob root '{self._root}' does not exist.")

    def _path(self, container: str) -> pathlib.Path:
        """Resolve the directory that mimics a blob container."""
        path = self._root / container
        if not path.exists():
            raise RepositoryError(f"Container '{container}' missing under '{self._root}'.")
        return path

    def list_blobs(self, container: str) -> Iterable[BlobRecord]:
        """Yield BlobRecord entries by walking the local filesystem container."""
        base = self._path(container)
        for path in base.rglob("*"):
            if path.is_file():
                # Preserve the blob naming convention by converting path separators to forward slashes.
                stat = path.stat()
                name = str(path.relative_to(base)).replace(os.sep, "/")
                yield BlobRecord(container=container, name=name, last_modified=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc), size=stat.st_size)

    def download_text(self, container: str, blob_name: str) -> str:
        """Return the contents of a local file that represents a blob."""
        base = self._path(container)
        path = (base / blob_name).resolve()
        if not path.is_file():
            raise RepositoryError(f"Blob '{blob_name}' absent in '{container}'.")
        return path.read_text(encoding="utf-8")
