# Deployment TODO — SCAI Docker / Bicep

## Pre-Deployment: Fill In Parameter File

File: `parameters/GFIM/main.scai.gfim.devgov.bicepparam`
- [x] Set `existingAcrName` — replace `'<acr-name>'` with your ACR name (e.g. `crfedairsscaidevva`)
- [x] Verify `existingStorageAccountName` — currently `'stgfedairsscaidevva'`
- [x] Verify `openAiChatDeploymentName` — currently `'gpt-4o'`, must match an actual deployment in your OpenAI resource
- [x] Verify VNet/Subnet CIDRs (`10.1.0.0/16`, `10.1.1-3.0/26`) don't conflict — check with network team
- [X] If resources are in a different RG, uncomment and set `existingStorageAccountResourceGroup`, `existingOpenAiResourceGroup`, `existingAcrResourceGroup`

## Pre-Deployment: Azure Resources That Must Already Exist

These are referenced as `existing` in the Bicep — deployment will fail if they're missing.

- [x] **Azure Container Registry** — `az acr show --name <acr-name>`
- [x] **Storage Account** — `az storage account show --name <storage account name>`
- [x] **Azure OpenAI resource** — `az cognitiveservices account show --name <aoai name> -g <rg>`
- [x] **OpenAI model deployment** (gpt-4o) — `az cognitiveservices account deployment list --name aoai-fedairs-scai-dev-va -g <rg>`
- [x] **Resource Group** — `az group show --name <rg>`

## Pre-Deployment: Build & Push Docker Images

- [x] Build frontend image: `docker build -t <acr>.azurecr.us/swft-frontend:<tag> -f frontend/Dockerfile frontend/`
- [x] Build backend image: `docker build -t <acr>.azurecr.us/swft-backend:<tag> -f backend/Dockerfile .`
- [x] Login to ACR: `az acr login --name <acr-name>`
- [x] Push frontend image: `docker push <acr>.azurecr.us/swft-frontend:<tag>`
- [x] Push backend image: `docker push <acr>.azurecr.us/swft-backend:<tag>`
- [x] Verify images in ACR: `az acr repository show-tags --name <acr> --repository swft-frontend`

## Deploy

- [ ] Run Bicep deployment:
  ```
  az deployment group create -g <rg> -f main.scai.bicep \
    -p parameters/GFIM/main.scai.gfim.devgov.bicepparam \
    -p uiImageTag=<tag> apiImageTag=<tag>
  ```

## Post-Deployment Verification

- [ ] Get frontend URL: `az webapp show -g <rg> -n <frontend-app> --query defaultHostNames[0] -o tsv`
- [ ] Browse frontend — confirm SPA loads
- [ ] Confirm `/api/` calls go through nginx proxy (no CORS, single origin in DevTools Network tab)
- [ ] Check backend health via proxy: `https://<frontend-app>.azurewebsites.us/api/`
- [ ] Review container logs: `az webapp log tail -g <rg> -n <app-name>`

## What Bicep Creates (no action needed)

These are provisioned automatically by the template:

- App Service Plan (Linux, B2) + Frontend & Backend App Services (Docker mode)
- VNet + 3 subnets (gateway, web, services)
- NSG + Route Table
- 7 Private DNS Zones + VNet links (blob, queue, file, table, OpenAI, Cognitive Services, web)
- Private Endpoints (Storage ×4, OpenAI, both App Services)
- 2 User-Assigned Managed Identities + RBAC (AcrPull ×2, Storage Blob Contributor/Owner, Queue Contributor, OpenAI Contributor/User)
