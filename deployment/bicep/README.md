# Azure App Service Deployment (Docker Containers) — SCAI Application

Deployment guide for SCAI frontend (React SPA) and backend (Python FastAPI) as **Docker containers** on Azure App Service, using `main.scai.bicep`.

> For the older zip-deploy/Oryx approach, see [`../mvp/README.md`](../mvp/README.md).

## Architecture

Both services run as Docker containers pulled from an Azure Container Registry (ACR). The frontend container runs **nginx** which serves the compiled Vite bundle **and** reverse-proxies `/api/*` requests to the backend App Service through VNet integration. This means:

- The backend can stay fully private (`publicNetworkAccess: Disabled`)
- The browser only talks to the frontend origin — no cross-origin (CORS) issues
- nginx resolves the backend's private endpoint via the VNet-linked DNS zone

```
Browser  →  Frontend App Service (public)  →  VNet Integration  →  Backend App Service (private)
             nginx: static + /api proxy         subnet: web            subnet: gateway (PE)
             (Docker: swft-frontend)                                    (Docker: swft-backend)
```

## What Gets Deployed

### Infrastructure (via `main.scai.bicep`)

- **App Service Plan** (Linux, B2 SKU) — shared by frontend and backend
- **Frontend App Service** — Docker container (nginx + API proxy), pulls `swft-frontend` from ACR
- **Backend App Service** — Docker container (FastAPI/uvicorn), pulls `swft-backend` from ACR
- **User-Assigned Managed Identities** (API + UI) — with AcrPull role on ACR
- **VNet** with 3 subnets (gateway for PEs, web for App Service integration, services reserved)
- **Private DNS Zones** + VNet Links (blob, queue, file, table, OpenAI, Cognitive Services, web)
- **Private Endpoints** (Storage ×4, OpenAI, both App Services)
- **RBAC Role Assignments** (AcrPull ×2, Storage Blob Data Contributor/Owner, Queue Contributor, OpenAI Contributor/User)

### Container Images (built and pushed to ACR)

| Image | Source | Listens on |
|-------|--------|-----------|
| `swft-frontend` | `frontend/Dockerfile` (multi-stage: Node build → nginx runtime) | 8080 |
| `swft-backend` | `backend/Dockerfile` (multi-stage: Python build → uvicorn runtime) | 8000 |

## Prerequisites

- Azure CLI installed: `az --version`
- Docker Desktop or Docker Engine
- Azure subscription (Azure Government)
- Access to existing Azure resources:
  - Storage Account (already deployed)
  - Azure OpenAI (already deployed)
  - Azure Container Registry (already deployed)

---

## Step 1: Build Docker Images

From the **repository root**:

```powershell
# Set variables
$ACR_NAME = "<acr-name>"                    # e.g. crfedairsscaidevva
$ACR_LOGIN_SERVER = "$ACR_NAME.azurecr.us"  # .azurecr.io for commercial cloud
$TAG = "v1"                                 # or use git SHA: $(git rev-parse --short HEAD)

# Build frontend image (context = frontend/)
docker build -t "${ACR_LOGIN_SERVER}/swft-frontend:${TAG}" -f frontend/Dockerfile frontend/

# Build backend image (context = repo root — needs backend/ and lookup/)
docker build -t "${ACR_LOGIN_SERVER}/swft-backend:${TAG}" -f backend/Dockerfile .
```

### Test locally before pushing

```powershell
# Quick smoke test — run backend
docker run --rm -p 8000:8000 "${ACR_LOGIN_SERVER}/swft-backend:${TAG}"
# In another terminal: curl http://localhost:8000/  →  {"status":"ok","service":"swft-backend"}

# Quick smoke test — run frontend with proxy to backend
docker run --rm -p 8080:8080 -e API_BACKEND_URL=http://host.docker.internal:8000 `
  "${ACR_LOGIN_SERVER}/swft-frontend:${TAG}"
# Browse http://localhost:8080
```

Or use Docker Compose for the full stack:

```powershell
docker compose up --build
# Browse http://localhost:8080
# API health: curl http://localhost:8080/api/
```

---

## Step 2: Push Images to ACR

```powershell
# Login to Azure Government
az cloud set --name AzureUSGovernment
az login

# Authenticate Docker to ACR
az acr login --name $ACR_NAME

# Push both images
docker push "${ACR_LOGIN_SERVER}/swft-frontend:${TAG}"
docker push "${ACR_LOGIN_SERVER}/swft-backend:${TAG}"
```

### Alternative: Build directly in ACR (no local Docker needed)

```powershell
# Build frontend in ACR
az acr build --registry $ACR_NAME --image "swft-frontend:${TAG}" -f frontend/Dockerfile frontend/

# Build backend in ACR (context = repo root)
az acr build --registry $ACR_NAME --image "swft-backend:${TAG}" -f backend/Dockerfile .
```

---

## Step 3: Deploy Infrastructure + Containers

Review the parameter file before deploying — update:
- `existingStorageAccountName` — your Storage Account
- `existingOpenAiName` — your Azure OpenAI resource
- `existingAcrName` — your ACR name

```powershell
# Deploy infrastructure with Bicep (from deployment/bicep/ folder)
cd deployment\bicep
az deployment group create `
  -g <your-resource-group> `
  -f main.scai.bicep `
  -p parameters/GFIM/main.scai.gfim.devgov.bicepparam `
  -p uiImageTag=$TAG apiImageTag=$TAG
```

> **What happens:** Bicep creates the App Services with `linuxFxVersion: 'DOCKER|<acr>/swft-frontend:<tag>'` and `DOCKER|<acr>/swft-backend:<tag>`. The App Services authenticate to ACR using their User-Assigned Managed Identities (AcrPull role). No zip deploy, no Oryx build — containers start directly.

---

## Step 4: Verify Deployment

```powershell
# Get Frontend URL
az webapp show -g <your-resource-group> -n <frontend-app-name> --query defaultHostNames[0] -o tsv

# Get Backend URL (should only be reachable via VNet / private endpoint)
az webapp show -g <your-resource-group> -n <backend-app-name> --query defaultHostNames[0] -o tsv
```

Visit: `https://<frontend-app-name>.azurewebsites.us`

Verify in browser DevTools (Network tab):
- All API requests go to the **frontend origin** (`/api/projects`, `/api/projects/.../runs`, etc.)
- No cross-origin requests to the backend URL
- No CORS preflight (OPTIONS) requests

---

## Configuration

### App Settings (set by Bicep)

**Frontend:**

| Setting | Purpose |
|---------|---------|
| `API_BACKEND_URL` | Backend URL for the nginx reverse proxy |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `false` — container brings its own filesystem |
| `DOCKER_REGISTRY_SERVER_URL` | ACR login server URL |
| `WEBSITES_PORT` | `8080` — port the nginx container listens on |

**Backend:**

| Setting | Purpose |
|---------|---------|
| `AZURE_CLIENT_ID` | Client ID of the API User-Assigned Managed Identity |
| `AZURE_STORAGE_ACCOUNT` | Storage account name |
| `AZURE_STORAGE_ENDPOINT_SUFFIX` | Storage endpoint suffix |
| `OPENAI_PROVIDER` | `azure` |
| `OPENAI_API_BASE` | Azure OpenAI endpoint URL |
| `OPENAI_API_VERSION` | API version |
| `OPENAI_USE_MANAGED_IDENTITY` | `true` — no API keys needed |
| `OPENAI_MODEL_NAME` | Chat deployment name |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `false` — container brings its own filesystem |
| `DOCKER_REGISTRY_SERVER_URL` | ACR login server URL |
| `WEBSITES_PORT` | `8000` — port the uvicorn container listens on |

### View Logs

```powershell
# Stream live logs
az webapp log tail -g <your-resource-group> -n <app-name>

# Download container startup logs
az webapp log download -g <your-resource-group> -n <app-name> --log-file logs.zip
```

---

## Updating the Application

```powershell
# Build new images with a new tag
$NEW_TAG = "v2"
docker build -t "${ACR_LOGIN_SERVER}/swft-frontend:${NEW_TAG}" -f frontend/Dockerfile frontend/
docker build -t "${ACR_LOGIN_SERVER}/swft-backend:${NEW_TAG}" -f backend/Dockerfile .

# Push to ACR
docker push "${ACR_LOGIN_SERVER}/swft-frontend:${NEW_TAG}"
docker push "${ACR_LOGIN_SERVER}/swft-backend:${NEW_TAG}"

# Option A: Update container image directly
az webapp config container set `
  -g <your-resource-group> `
  -n <frontend-app-name> `
  --docker-custom-image-name "${ACR_LOGIN_SERVER}/swft-frontend:${NEW_TAG}"

az webapp config container set `
  -g <your-resource-group> `
  -n <backend-app-name> `
  --docker-custom-image-name "${ACR_LOGIN_SERVER}/swft-backend:${NEW_TAG}"

# Option B: Re-run Bicep with new image tags
az deployment group create `
  -g <your-resource-group> `
  -f main.scai.bicep `
  -p parameters/GFIM/main.scai.gfim.devgov.bicepparam `
  -p uiImageTag=$NEW_TAG apiImageTag=$NEW_TAG
```

---

## Local Development

### Option 1: Docker Compose (full stack)

```powershell
docker compose up --build
# Frontend: http://localhost:8080
# Backend:  http://localhost:8000
# API via proxy: http://localhost:8080/api/
```

The backend container mounts `backend/app/` and `lookup/` as volumes and runs with `--reload`, so code changes are picked up automatically. The frontend is built at image build time — rebuild with `docker compose up --build frontend` after changing React code.

### Option 2: Native (Vite + uvicorn — fastest for frontend dev)

```powershell
# Terminal 1: Start backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level debug

# Terminal 2: Start frontend
cd frontend
npm install
npm run dev    # Vite dev server on http://localhost:5173
```

Vite's dev server (configured in `vite.config.ts`) proxies `/api/*` → `http://localhost:8000` with prefix stripping — same behavior as the nginx container proxy.

---

## Cleanup

```powershell
# Delete Azure resources
az group delete --name <your-resource-group> --yes --no-wait

# Remove local Docker images
docker rmi "${ACR_LOGIN_SERVER}/swft-frontend:${TAG}" "${ACR_LOGIN_SERVER}/swft-backend:${TAG}"
```

---

## Troubleshooting

### Container fails to start / "Application Error"

```powershell
az webapp log tail -g <rg> -n <app-name>
```

Common issues:
- ACR authentication failed — verify the UMI has `AcrPull` role on the ACR
- Image not found — verify the image tag exists: `az acr repository show-tags --name <acr> --repository swft-frontend`
- Port mismatch — `WEBSITES_PORT` must match the container's `EXPOSE` (8080 for frontend, 8000 for backend)

### 502 on API calls

The nginx proxy can't reach the backend. Check:
1. `API_BACKEND_URL` app setting is correct (should be `https://<backend-app>.azurewebsites.us`)
2. The frontend App Service has VNet integration enabled (web subnet)
3. The backend's private endpoint and web DNS zone are deployed
4. View frontend nginx error log: `az webapp log tail -g <rg> -n <frontend-app>`

### Backend returns connection errors to Storage/OpenAI

The managed identity may not have the required RBAC roles. Verify the role assignments deployed correctly, or check that `AZURE_CLIENT_ID` matches the UMI's client ID.

### Docker build fails locally

- Frontend: requires Node 24+ for the build stage (Vite 7+ needs package-level imports). Docker handles this — the Dockerfile uses `node:24-alpine`.
- Backend: requires the build context to be the repo root (not `backend/`) because it copies `lookup/`.
