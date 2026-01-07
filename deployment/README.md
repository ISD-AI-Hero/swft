# Azure App Service Deployment - SCAI Application

Deployment guide for SCAI frontend (React SPA) and backend (Python FastAPI) to Azure App Service.

## What Gets Deployed

- **App Service Plan** (Linux, B1 SKU ~$13/month) - shared by both frontend and backend
- **Frontend App Service** (Node.js 20 serving static Vite build)
- **Backend App Service** (Python 3.11 FastAPI)
- **System Managed Identities** (for secure Azure access)

## Prerequisites

- Azure CLI installed: `az --version`
- Azure subscription
- Node.js 20+ (for building frontend)
- Python 3.11+ (for building backend)
- Access to existing Azure resources:
  - Storage Account: `scaistg`
  - Azure OpenAI (optional)
  - Key Vault (optional)

---

## Manual Deployment Commands

### 1. Deploy Infrastructure

```powershell
# Login to Azure
az login

# Create resource group
az group create --name rg-Scai-Demo --location usgovvirginia

# Set storage connection string as secure parameter
$storageConnString = "DefaultEndpointsProtocol=https;EndpointSuffix=core.usgovcloudapi.net;AccountName=scaistg;AccountKey=YOUR_KEY_HERE;BlobEndpoint=https://scaistg.blob.core.usgovcloudapi.net/"

# Deploy infrastructure with Bicep
az deployment group create `
  -g rg-Scai-Demo `
  -f main.bicep `
  -p main.bicepparam `
  -p storageConnectionString="$storageConnString"
```

**Expected output:**

- App Service Plan: `asp-scai-dev`
- Frontend App Service: `scai-ui-dev`
- Backend App Service: `scai-api-dev`
- Frontend URL: `https://scai-ui-dev.azurewebsites.us`
- Backend API URL: `https://scai-api-dev.azurewebsites.us`

---

### 2. Build and Deploy Frontend

```powershell
# Navigate to frontend folder
cd ..\frontend

# Install dependencies
npm install

# Build production bundle
npm run build

# Create deployment package
Compress-Archive -Path dist\* -DestinationPath ..\deployment\frontend-deploy.zip -Force

# Go back to deployment folder
cd ..\deployment

# Deploy to Frontend App Service
az webapp deployment source config-zip -g rg-SCAI-Demo -n scai-ui-dev --src frontend-deploy.zip

# Clean up
Remove-Item frontend-deploy.zip
```

---

### 3. Build and Deploy Backend

```powershell
# Navigate to backend folder
cd ..\backend

# Create deployment package (include app folder, pyproject.toml, and lookup data)
Compress-Archive -Path app,pyproject.toml,README.md,..\lookup -DestinationPath ..\deployment\backend-deploy.zip -Force

# Go back to deployment folder
cd ..\deployment

# Deploy to Backend App Service
az webapp deployment source config-zip -g rg-SCAI-Demo -n scai-api-dev --src backend-deploy.zip

# Clean up
Remove-Item backend-deploy.zip
```

---

### 4. Verify Deployment

```powershell
# Get Frontend URL
az webapp show -g rg-Scai-Demo -n scai-ui-dev --query defaultHostNames[0] -o tsv

# Get Backend URL
az webapp show -g rg-Scai-Demo -n scai-api-dev --query defaultHostNames[0] -o tsv

# Test backend health
Invoke-WebRequest -Uri "https://scai-api-dev.azurewebsites.us/health" -Method GET
```

Visit: `https://scai-ui-dev.azurewebsites.us`

---

## Configuration

### Update API URL (Frontend)

```powershell
az webapp config appsettings set -g rg-Scai-Demo -n scai-ui-dev --settings VITE_API_BASE_URL="https://scai-api-dev.azurewebsites.us"

# Restart app to apply changes
az webapp restart -g rg-Scai-Demo -n scai-ui-dev
```

### Update Storage Configuration (Backend)

```powershell
# Update storage connection string
az webapp config appsettings set -g rg-Scai-Demo -n scai-api-dev --settings AZURE_STORAGE_CONNECTION_STRING="your-connection-string"

# Restart app to apply changes
az webapp restart -g rg-Scai-Demo -n scai-api-dev
```

### Disable/Enable Public Access

```powershell
# Disable public access (only accessible via Private Endpoint or VNet)
az webapp update -g rg-Scai-Demo -n scai-ui-dev --set publicNetworkAccess=Disabled

# Enable public access
az webapp update -g rg-Scai-Demo -n scai-ui-dev --set publicNetworkAccess=Enabled
```

### View Logs

```powershell
# Stream live logs (Frontend)
az webapp log tail -g rg-Scai-Demo -n scai-ui-dev

# Stream live logs (Backend)
az webapp log tail -g rg-Scai-Demo -n scai-api-dev
```

---

## Customization

Edit `main.bicepparam` to change:

```bicep
param appServiceName = 'your-unique-name'       // Frontend app name
param backendAppServiceName = 'your-api-name'   // Backend app name
param location = 'eastus'                        // Azure region
param apiUrl = 'https://api.example.com'        // Backend URL for frontend
```

---

## Cleanup

```powershell
# Delete everything
az group delete --name rg-Scai-Demo --yes --no-wait
```

---

## Cost Estimate

- **B1 App Service Plan**: ~$13/month (shared by frontend and backend)
- **First 750 hours free** with Azure Free Tier

---

## Troubleshooting

### App shows "Your web app is running"

The frontend hasn't been deployed yet. Run step 2 above.

### 404 errors on refresh

SPA routing is handled by the `serve` package with the `-s` flag.

### Build fails

Check Node.js version: `node --version` (should be 20+)

### Deployment fails

Check if app name is globally unique:

```powershell
az webapp show -g rg-Scai-Demo -n scai-ui-dev --query name -o tsv
```

### Backend errors

Check logs for Python dependencies or storage connection issues:

```powershell
az webapp log tail -g rg-Scai-Demo -n scai-api-dev
```
