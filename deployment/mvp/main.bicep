
targetScope = 'resourceGroup'

@description('Name of the App Service (must be globally unique)')
param appServiceName string = 'scai-frontend-dev'

@description('Name of the App Service (must be globally unique)')
param appServicePlanName string = 'asp-scai-dev'

@description('Azure region')
param location string = resourceGroup().location

@description('Backend API URL')
param apiUrl string = ''

@description('Name of the Backend App Service (must be globally unique)')
param backendAppServiceName string = 'scai-api-dev'

@description('Azure Storage Account Name for backend')
param storageAccountName string = ''

@description('Azure Storage Connection String for backend')
@secure()
param storageConnectionString string = ''

@description('Azure Tenant ID')
param azureTenantId string = ''

@description('Client ID of the backend app registration (scai-backend-api)')
param authClientId string = ''

@description('Comma-separated list of allowed CORS origins, e.g. https://scai-ui-dev.azurewebsites.us')
param allowedOrigins string = ''



// ============================================================================
// App Service Plan (Linux, B1 SKU)
// ============================================================================
module appServicePlan 'br/public:avm/res/web/serverfarm:0.4.0' = {
  name: appServicePlanName
  params: {
    name: appServicePlanName
    location: location
    skuName: 'B1'
    kind: 'linux'
    reserved: true
    tags: {
      Environment: 'dev'
      Application: 'scai-frontend'
    }
  }
}

// ============================================================================
// Frontend App Service (Node.js 20 - Static SPA)
// ============================================================================
module appService 'br/public:avm/res/web/site:0.12.0' = {
  name: appServiceName
  params: {
    name: appServiceName
    location: location
    kind: 'app,linux'
    serverFarmResourceId: appServicePlan.outputs.resourceId
    httpsOnly: true
    publicNetworkAccess: 'Disabled'
    
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'npx --yes serve@latest -s /home/site/wwwroot -l 8080'
      appSettings: [
        {
          name: 'VITE_API_BASE_URL'
          value: apiUrl
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '20-lts'
        }
        {
          name: 'PORT'
          value: '8080'
        }
      ]
    }
    
    managedIdentities: {
      systemAssigned: true
    }
    
    tags: {
      Environment: 'dev'
      Application: 'scai-frontend'
    }
  }
}

// ============================================================================
// Backend App Service (Python 3.11 FastAPI)
// ============================================================================
module backendAppService 'br/public:avm/res/web/site:0.12.0' = {
  name: backendAppServiceName
  params: {
    name: backendAppServiceName
    location: location
    kind: 'app,linux'
    serverFarmResourceId: appServicePlan.outputs.resourceId
    httpsOnly: true
    publicNetworkAccess: 'Disabled'
    
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.11'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'python -m uvicorn app.main:app --host 0.0.0.0 --port 8000'
      appSettings: [
        {
          name: 'AZURE_STORAGE_ACCOUNT'
          value: storageAccountName
        }
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: storageConnectionString
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_SBOMS'
          value: 'sboms'
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_SCANS'
          value: 'scans'
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_RUNS'
          value: 'runs'
        }
          {
          name: 'OPENAI_PROVIDER'
          value: 'azure'
        }
        {
          name: 'OPENAI_API_KEY'
          value: '<KeyGoesHere>'  // In the future, use Key Vault reference
        }
        {
          name: 'OPENAI_API_BASE'
          value: 'https://scai-ai.openai.azure.us/'
          // For dynamic reference when OpenAI module is deployed, use: openAI.outputs.endpoint
        }
        {
          name: 'OPENAI_API_VERSION'
          value: '2024-11-20'
        }      
        {
          name: 'AZURE_TENANT_ID'
          value: azureTenantId
        }
        {
          name: 'AUTH_ENABLED'
          value: 'true'
        }
        {
          name: 'AUTH_CLIENT_ID'
          value: authClientId
        }
        {
          name: 'AUTH_AUTHORITY_HOST'
          value: 'https://login.microsoftonline.us'
        }
        {
          name: 'ALLOWED_ORIGINS'
          value: allowedOrigins
        }
        {
          name: 'CACHE_TTL_SECONDS'
          value: '60'
        }
        {
          name: 'CACHE_MAX_ITEMS'
          value: '256'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'true'
        }

      ]
    }
    
    managedIdentities: {
      systemAssigned: true
    }
    
    tags: {
      Environment: 'dev'
      Application: 'scai-backend'
    }
  }
}




// ============================================================================
// Outputs
// ============================================================================
output appServiceName string = appService.outputs.name
output appServiceUrl string = 'https://${appService.outputs.defaultHostname}'
output appServiceResourceId string = appService.outputs.resourceId

