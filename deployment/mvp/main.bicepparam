using './main.bicep'

param location = 'usgovvirginia'
param apiUrl = 'https://scai-api-dev.azurewebsites.us'

param appServicePlanName = 'asp-scai-dev'
param appServiceName = 'scai-ui-dev'
param backendAppServiceName = 'scai-api-dev'

// Backend configuration (update with your actual values)
param storageAccountName = 'scaistg'
param storageConnectionString = '' // Define or Set this via secure parameter during deployment // Future: dynamically pull from bicep resource declaration
param azureTenantId = 'de53bc81-f5be-4d12-92a9-43d47ef8cf2d'
param authClientId = 'd11e787e-bef4-47b7-970f-ae80fe1496f0'
param allowedOrigins = 'https://scai-ui-dev.azurewebsites.us'

