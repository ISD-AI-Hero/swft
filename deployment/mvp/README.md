# MVP Deployment (Zip Deploy / Oryx Build) — SCAI Application

> **This is NOT the Docker container approach.**
> This folder contains an earlier MVP Bicep template that uses **zip deploy with Oryx build** —
> the frontend runs on Node.js (`npx serve`) and the backend uses Python runtime directly on
> App Service.
>
> **For the production Docker container deployment (nginx reverse proxy + ACR), see
> [`../bicep/README.md`](../bicep/README.md).**


## Why This Won't Work in Production

This template was built for quick local validation — it is **not production-ready** and will not
function in a network-locked-down environment.

### No Reverse Proxy → CORS + Exposed Backend

The frontend is just `npx serve` hosting static files. There is no `/api/*` proxy, so the React
SPA must make cross-origin requests directly to the backend's public URL. This requires:
- CORS headers on every backend response
- The backend to be **publicly accessible** (defeating the purpose of locking it down)

In production, the backend should be **private** (no public endpoint). The Docker approach solves
this with nginx in the frontend container reverse-proxying `/api/*` to the backend over the VNet —
the browser never talks to the backend directly.

### No VNet / Private Endpoints → Dead on Arrival in Locked-Down Networks

The template sets `publicNetworkAccess: Disabled` on both App Services but **does not provision any
VNet, subnets, private endpoints, or DNS zones**. This means:
- Neither App Service is reachable from the internet (public access is off)
- Neither App Service is reachable from the other (no private networking exists)
- The backend can't reach Storage or OpenAI over private endpoints (none are created)

In a network-locked-down environment (IL4/IL5, CAC-required, firewall-controlled egress), all
traffic must flow over private endpoints within a VNet. This template has none of that plumbing.
The Docker/Bicep approach (`main.scai.bicep`) provisions the full networking stack.

### Additional Limitations

- **Oryx build is slow** — every deploy rebuilds dependencies from scratch on the App Service
- **No ACR / container images** — cannot pin exact image versions or roll back to a known-good image
- **API key in app settings** — `OPENAI_API_KEY` is hardcoded in plain text; the Docker/Bicep
  approach uses User-Assigned Managed Identity (no secrets to manage)
- **No managed identity for Storage** — uses a connection string instead of RBAC-based access
- **`npx serve` is not a production web server** — it's a development convenience tool with no
  gzip, caching headers, connection pooling, or security hardening (nginx in the Docker approach
  handles all of this)

## What This Template Does

`main.bicep` deploys:

- **App Service Plan** (Linux, B1)
- **Frontend App Service** — `NODE|20-lts` with `npx serve` to serve the Vite build output
- **Backend App Service** — `PYTHON|3.11` with `uvicorn` startup command, Oryx builds dependencies on deploy

This approach uses `SCM_DO_BUILD_DURING_DEPLOYMENT` and `ENABLE_ORYX_BUILD` — App Service builds
and installs dependencies from your source code at deploy time (no Docker images involved).


## Deploy (If Needed)

```powershell
az cloud set --name AzureUSGovernment
az login

az deployment group create `
  -g <your-resource-group> `
  -f deployment/mvp/main.bicep `
  -p deployment/mvp/main.bicepparam
```
