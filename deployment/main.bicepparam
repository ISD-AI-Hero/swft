using './main.bicep'

param location = 'usgovvirginia'
param apiUrl = 'https://scai-api-dev.azurewebsites.us'

param appServicePlanName = 'asp-scai-dev'
param appServiceName = 'scai-ui-dev'
param backendAppServiceName = 'scai-api-dev'

// Backend configuration (update with your actual values)
param storageAccountName = 'scaistg'
param storageConnectionString = '' // Define or Set this via secure parameter during deployment
param azureTenantId = 'de53bc81-f5be-4d12-92a9-43d47ef8cf2d'




// UNTESTED PARAMETERS

// param containerRegistryName = 'scaicr'
// param containerRegistrySku = 'Premium'
// param storageAccountName = 'scaistg'
// param storageAccountSku = 'Standard_RAGRS'
// param keyVaultName = 'kv-scai-demo'
// param keyVaultSku = 'standard'
// param keyVaultAllowedIPs = []

// // Container Registry - Sonarqube Configuration
// param containerRegistryWebhookUri = '' // https://REDACTED:REDACTED@sonarqube-mcp.scm.azurewebsites.us/docker/hook
// param containerRegistryWebhookName = ''
// param containerRegistryWebhookScope = '' // i.e <image>:<tag> => sonarqube-mcp-server:85......

// // Azure OpenAI Configuration
// param openAIAccountName = 'SCAI-AI'
// param openAICustomSubdomain = 'scai-ai'
// param openAISku = 'S0'
// param openAIAllowedIPs = []
// param openAIDeploymentName = 'gpt-4o'
// param openAIModelName = 'gpt-4o'
// param openAIModelVersion = '2024-11-20'
// param openAIModelCapacity = 80


