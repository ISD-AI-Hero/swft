
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


// UNTESTED PARAMETERS FOR FUTURE USE

// @description('Container Registry Name (must be globally unique, alphanumeric only)')
// param containerRegistryName string = 'scaicr'

// @description('Container Registry SKU')
// @allowed(['Basic', 'Standard', 'Premium'])
// param containerRegistrySku string = 'Premium'

// @description('Storage Account Name (must be globally unique, lowercase alphanumeric only)')
// param storageAccountName string = 'scaistg'

// @description('Storage Account SKU')
// @allowed(['Standard_LRS', 'Standard_GRS', 'Standard_RAGRS', 'Standard_ZRS', 'Premium_LRS'])
// param storageAccountSku string = 'Standard_RAGRS'

// @description('Key Vault Name (must be globally unique)')
// param keyVaultName string = 'kv-scai-demo'

// @description('Key Vault SKU')
// @allowed(['standard', 'premium'])
// param keyVaultSku string = 'standard'

// @description('IP addresses allowed to access Key Vault (CIDR format)')
// param keyVaultAllowedIPs array = []

// @description('Container Registry webhook service URI')
// @secure()
// param containerRegistryWebhookUri string = ''

// @description('Container Registry webhook name')
// param containerRegistryWebhookName string = 'SonarQubeMCP155252'

// @description('Container Registry webhook scope (image:tag)')
// param containerRegistryWebhookScope string = 'sonarqube-mcp-server:896e616cea5b02595512206bd8f775b56c98db0f'

// @description('Azure OpenAI Account Name')
// param openAIAccountName string = 'SCAI-AI'

// @description('Azure OpenAI Custom Subdomain')
// param openAICustomSubdomain string = 'scai-ai'

// @description('Azure OpenAI SKU')
// @allowed(['S0'])
// param openAISku string = 'S0'

// @description('IP addresses allowed to access Azure OpenAI')
// param openAIAllowedIPs array = []

// @description('Azure OpenAI Model Deployment Name')
// param openAIDeploymentName string = 'gpt-4o'

// @description('Azure OpenAI Model Name')
// param openAIModelName string = 'gpt-4o'

// @description('Azure OpenAI Model Version')
// param openAIModelVersion string = '2024-11-20'

// @description('Azure OpenAI Model Capacity (TPM in thousands)')
// param openAIModelCapacity int = 80

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


// UNTESTED AUTOMATED DEPLOYMENT OF RESOURCES FOR FUTURE USE

// // ============================================================================
// // Azure Container Registry
// // ============================================================================
// module containerRegistry 'br/public:avm/res/container-registry/registry:0.7.0' = {
//   name: containerRegistryName
//   params: {
//     name: containerRegistryName
//     location: location
//     acrSku: containerRegistrySku
    
//     // Enable admin user for easier access
//     acrAdminUserEnabled: true
    
//     // Network settings
//     publicNetworkAccess: 'Enabled'
//     networkRuleBypassOptions: 'AzureServices'
    
//     // Zone redundancy for high availability
//     zoneRedundancy: 'Enabled'
    
//     // Policies
//     anonymousPullEnabled: false
//     dataEndpointEnabled: false
//     exportPolicyStatus: 'enabled'
//     azureADAuthenticationAsArmPolicyStatus: 'enabled'
    
//     // Retention and trust policies
//     retentionPolicyDays: 7
//     retentionPolicyStatus: 'disabled'
//     trustPolicyStatus: 'disabled'
//     quarantinePolicyStatus: 'disabled'
//     softDeletePolicyDays: 7
//     softDeletePolicyStatus: 'disabled'
    
//     // Webhooks
//     webhooks: !empty(containerRegistryWebhookUri) ? [
//       {
//         name: containerRegistryWebhookName
//         serviceUri: containerRegistryWebhookUri
//         actions: [
//           'push'
//         ]
//         status: 'enabled'
//         scope: containerRegistryWebhookScope
//       }
//     ] : []
    
//     managedIdentities: {
//       systemAssigned: true
//     }
    
//     tags: {
//       Environment: 'dev'
//       Application: 'scai'
//     }
//   }
// }

// // ============================================================================
// // Storage Account
// // ============================================================================
// module storageAccount 'br/public:avm/res/storage/storage-account:0.15.0' = {
//   name: storageAccountName
//   params: {
//     name: storageAccountName
//     location: location
//     skuName: storageAccountSku
//     kind: 'StorageV2'
    
//     // Network and security settings
//     publicNetworkAccess: 'Enabled'
//     allowBlobPublicAccess: false
//     allowSharedKeyAccess: true
//     allowCrossTenantReplication: false
//     minimumTlsVersion: 'TLS1_2'
//     supportsHttpsTrafficOnly: true
    
//     // Network ACLs
//     networkAcls: {
//       bypass: 'AzureServices'
//       defaultAction: 'Allow'
//       virtualNetworkRules: []
//       ipRules: []
//     }
    
//     // Access tier
//     accessTier: 'Hot'
    
//     // Large file shares
//     largeFileSharesState: 'Enabled'
    
//     // Blob service configuration
//     blobServices: {
//       containers: [
//         {
//           name: 'artifacts'
//           publicAccess: 'None'
//         }
//         {
//           name: 'runs'
//           publicAccess: 'None'
//         }
//         {
//           name: 'sboms'
//           publicAccess: 'None'
//         }
//         {
//           name: 'scans'
//           publicAccess: 'None'
//         }
//       ]
//       deleteRetentionPolicyEnabled: true
//       deleteRetentionPolicyDays: 7
//       deleteRetentionPolicyAllowPermanentDelete: false
//       containerDeleteRetentionPolicyEnabled: true
//       containerDeleteRetentionPolicyDays: 7
//     }
    
//     // File service configuration
//     fileServices: {
//       shareDeleteRetentionPolicyEnabled: true
//       shareDeleteRetentionPolicyDays: 7
//     }
    
//     managedIdentities: {
//       systemAssigned: true
//     }
    
//     tags: {
//       Environment: 'dev'
//       Application: 'scai'
//     }
//   }
// }

// // ============================================================================
// // Key Vault
// // ============================================================================
// module keyVault 'br/public:avm/res/key-vault/vault:0.12.0' = {
//   name: keyVaultName
//   params: {
//     name: keyVaultName
//     location: location
//     sku: keyVaultSku
    
//     // Enable RBAC authorization
//     enableRbacAuthorization: true
    
//     // Enable for Azure services
//     enableVaultForDeployment: true
//     enableVaultForDiskEncryption: true
//     enableVaultForTemplateDeployment: true
    
//     // Soft delete configuration
//     enableSoftDelete: true
//     softDeleteRetentionInDays: 90
//     enablePurgeProtection: false
    
//     // Network configuration
//     publicNetworkAccess: 'Enabled'
//     networkAcls: {
//       bypass: 'AzureServices'
//       defaultAction: 'Deny'
//       ipRules: [for ip in keyVaultAllowedIPs: {
//         value: ip
//       }]
//     }
    
//     // Secrets (empty - values will be added manually or via separate deployment)
//     secrets: [
//       {
//         name: 'SCAI-OpenAI-Endpoint'
//         value: ''
//       }
//       {
//         name: 'SCAI-OpenAI-Key'
//         value: ''
//       }
//       {
//         name: 'SCAI-OpenAI-Model'
//         value: ''
//       }
//       {
//         name: 'SCAI-SonarQube-Token'
//         value: ''
//       }
//       {
//         name: 'SCAI-SonarQube-Url'
//         value: ''
//       }
//     ]
    
//     tags: {
//       Environment: 'dev'
//       Application: 'scai'
//     }
//   }
// }

// // ============================================================================
// // Azure OpenAI
// // ============================================================================
// module openAI 'br/public:avm/res/cognitive-services/account:0.9.1' = {
//   name: openAIAccountName
//   params: {
//     name: openAIAccountName
//     location: location
//     kind: 'OpenAI'
//     customSubDomainName: openAICustomSubdomain
//     sku: openAISku
    
//     // Network configuration
//     publicNetworkAccess: 'Enabled'
//     networkAcls: {
//       defaultAction: 'Deny'
//       bypass: 'AzureServices'
//       ipRules: [for ip in openAIAllowedIPs: {
//         value: ip
//       }]
//     }
    
//     // Deployments (GPT-4o model)
//     deployments: [
//       {
//         name: openAIDeploymentName
//         model: {
//           format: 'OpenAI'
//           name: openAIModelName
//           version: openAIModelVersion
//         }
//         sku: {
//           name: 'Standard'
//           capacity: openAIModelCapacity
//         }
//         raiPolicyName: 'Microsoft.Default'
//         versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
//       }
//     ]
    
//     // Disable local auth
//     disableLocalAuth: false
    
//     managedIdentities: {
//       systemAssigned: true
//     }
    
//     tags: {
//       Environment: 'dev'
//       Application: 'scai'
//     }
//   }
// }

// ============================================================================
// Outputs
// ============================================================================
output appServiceName string = appService.outputs.name
output appServiceUrl string = 'https://${appService.outputs.defaultHostname}'
output appServiceResourceId string = appService.outputs.resourceId

// output containerRegistryName string = containerRegistry.outputs.name
// output containerRegistryLoginServer string = containerRegistry.outputs.loginServer
// output containerRegistryResourceId string = containerRegistry.outputs.resourceId

// output storageAccountName string = storageAccount.outputs.name
// output storageAccountResourceId string = storageAccount.outputs.resourceId

// output keyVaultName string = keyVault.outputs.name
// output keyVaultUri string = keyVault.outputs.uri
// output keyVaultResourceId string = keyVault.outputs.resourceId

// output openAIAccountName string = openAI.outputs.name
// output openAIEndpoint string = openAI.outputs.endpoint
// output openAIResourceId string = openAI.outputs.resourceId
