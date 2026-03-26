# SWFT Backend

FastAPI-based API that surfaces SWFT pipeline outputs directly from Azure Blob Storage. The service provides project, run, and artifact views used by the portal frontend.

## Local Development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --reload
```

Copy `.env.example` to `.env` and update the values, or export them directly in your shell:

- `AZURE_STORAGE_ACCOUNT` — storage account name (or connection string when using `AZURE_STORAGE_CONNECTION_STRING`)
- `AZURE_STORAGE_CONNECTION_STRING` — optional connection string (takes precedence)
- `AZURE_STORAGE_CONTAINER_SBOMS` — container name for SBOM blobs (default `sboms`)
- `AZURE_STORAGE_CONTAINER_SCANS` — container name for Trivy scan blobs (default `scans`)
- `AZURE_STORAGE_CONTAINER_RUNS` — container name for run manifests (default `runs`)
- `AZURE_STORAGE_CONTAINER_APPDESIGN` — container name for `app-design.md` blobs (default `appdesign`)
- `AZURE_STORAGE_BLOB_PREFIX_DELIMITER` — delimiter between project and run identifiers (default `-`)
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` — optional service principal credentials; otherwise managed identity/CLI auth is used
- `LOCAL_BLOB_ROOT` — optional filesystem path for offline development; when set the service reads blobs from disk instead of Azure
- `SWFT_DB_HOST`, `SWFT_DB_NAME`, `SWFT_DB_USER`, `SWFT_DB_AUTH`, `SWFT_DB_PASSWORD` — required to enable the SWFT workspace endpoints; when missing, those routes return HTTP 503 with an explanatory error

## Testing

```bash
pytest
```

## Packaging

A container image can be built from the repository root:

```bash
docker build -t swft-backend -f backend/Dockerfile .
```

## Deploying to Azure App Service

**Scope:** The instructions below apply to the **backend only**. The frontend is a separate stack (Node/Vite → static files → nginx). To deploy the **entire app** (backend + frontend), see [Deploying the full app (backend + frontend)](#deploying-the-full-app-backend--frontend) below.

### Why you might see `[tool.poetry] section not found`

The backend uses **setuptools** and PEP 621 in `pyproject.toml`, not Poetry. Azure App Service’s Oryx build often treats `pyproject.toml` as a Poetry project and then fails with `[tool.poetry] section not found` when that section is missing. This can happen in **code** deployments (Git, ZIP, etc.), including in **Azure US Government** regions.

### Option 1: Docker (recommended, especially for US Gov)

Use **Web App for Containers** so Oryx is never used:

1. Build and push the backend image (e.g. to Azure Container Registry, including US Gov ACR).
2. Create a Linux App Service with **Docker** as the stack.
3. Configure the app to use your image (and optional startup command).

The `backend/Dockerfile` is set up for this. Your CI can build it and deploy the container to App Service.

### Option 2: Code deploy with `requirements.txt`

If you deploy **source** (e.g. ZIP or Azure Developer CLI) and use Oryx:

1. **Deploy the `backend` folder** as the application root (not the repo root).
2. Rely on `requirements.txt` and `runtime.txt` in `backend/`. Use **`.deploymentignore`** so `pyproject.toml` (and other excluded files) are **not** included in the deployment package. Oryx will then use **pip** and `requirements.txt` instead of Poetry, which avoids the error.

3. **Startup command** (App Service → Configuration → General settings):

   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

   If your platform uses the `PORT` env var, you may need to adapt the port (e.g. via a small wrapper script or platform-specific config).

4. **Application settings**: Configure `AZURE_STORAGE_*`, `SWFT_DB_*`, etc., as in local development.

**Note:** For **Git-based** deploy (e.g. App Service build from GitHub), the build runs on the cloned repo. If your deploy pipeline does **not** use `.deploymentignore` (e.g. it deploys the full clone), `pyproject.toml` will still be present and the Poetry error can recur. In that case, prefer **Docker** (Option 1) or a CI-built package that contains only `app/`, `requirements.txt`, `runtime.txt`, and no `pyproject.toml`.

### Deploying the full app (backend + frontend)

The portal has two parts:

- **Backend**: Python/FastAPI (this repo). Use the options above (Docker or Oryx + `requirements.txt`).
- **Frontend**: React + Vite, built to static files and served by nginx (`frontend/Dockerfile`). It calls the backend API; the base URL is set at build time via `VITE_API_BASE_URL` (default `/api`).

**Option A – Two App Services (recommended)**

1. **Backend App Service**
   - Deploy the backend via **Docker** (Option 1) or **code deploy** (Option 2) as above.
   - Note the backend URL (e.g. `https://<your-backend>.azurewebsites.net` or your custom domain).

2. **Frontend App Service**
   - Build the frontend image with the backend URL baked in:
     ```bash
     docker build -t swft-frontend --build-arg VITE_API_BASE_URL=https://<your-backend>.azurewebsites.net -f frontend/Dockerfile frontend
     ```
   - Push the image to your registry and deploy it to a **second** Linux App Service (Web App for Containers). The frontend container serves on port **8080**; ensure the App Service is configured for that port.

   Alternatively, build the frontend (`npm run build` in `frontend/`), then deploy the `frontend/dist/` output to **Azure Static Web Apps** or another static host. Configure the backend URL via `VITE_API_BASE_URL` at build time, and ensure CORS allows the frontend origin if it differs from the backend.

3. **CORS**: The backend allows `allow_origins=["*"]`. If you restrict origins, add your frontend App Service (or Static Web Apps) URL.

**Option B – Single App Service (backend serves the SPA)**

You can serve both the API and the React SPA from one App Service by extending the backend:

1. Build the frontend (`npm run build` in `frontend/`), then copy `frontend/dist/` into the backend image.
2. Mount the static files in FastAPI and add a catch‑all route that serves `index.html` for client-side routing.
3. Use a single Docker image and deploy it to one Web App for Containers. The app serves the API (e.g. under `/api`) and the SPA (under `/`).

This requires Dockerfile and FastAPI changes; the repo does not currently provide a combined image. Use **Option A** unless you need a single App Service.
