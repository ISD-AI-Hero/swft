targetScope = 'resourceGroup'

param location string = resourceGroup().location

@allowed(['DEV', 'UAT', 'TEST', 'PROD', 'SBX'])
param env string

param customer string

param product string = 'scai'

// ============================================================================
// NETWORKING CONFIGURATION
// ============================================================================

param virtualNetworkSubscriptionId string = subscription().subscriptionId
param virtualNetworkResourceGroupName string = resourceGroup().name
param virtualNetworkNameFinal string
param vNetAddressPrefix string
param subnetNamePrefixFinal string

param subnets array = []

// Network Security Configuration
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Disabled'
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccessUIAppService string = publicNetworkAccess
param httpsOnly bool = true
param vnetRouteAllEnabled bool = true
param vnetContentShareEnabled bool = true
param vnetImagePullEnabled bool = true

// Routing Configuration
param sourceToHubAddressPrefix string = ''
param hubFirewallIPAddress string = ''
param hubRoutingRuleName string = 'MLZ_HUB'

// ============================================================================
// APP SERVICE CONFIGURATION
// ============================================================================

param skuNameAppServicePlan string = 'B2'
param serverFarmSkuCapacity int = 1
param isGovDeployment bool = true

// ============================================================================
// EXISTING RESOURCE REFERENCES
// ============================================================================

@description('Name of the already-deployed Azure Storage Account')
param existingStorageAccountName string

@description('Resource group of the existing Storage Account (defaults to current RG)')
param existingStorageAccountResourceGroup string = resourceGroup().name

@description('Name of the already-deployed Azure OpenAI resource')
param existingOpenAiName string

@description('Resource group of the existing Azure OpenAI resource (defaults to current RG)')
param existingOpenAiResourceGroup string = resourceGroup().name

@description('Deployment name for the chat model in OpenAI')
param openAiChatDeploymentName string = 'gpt-4o'

@description('API version for the OpenAI service')
param openAiApiVersion string = '2024-10-21'

// ============================================================================
// CONTAINER REGISTRY CONFIGURATION
// ============================================================================

@description('Name of the already-deployed Azure Container Registry')
param existingAcrName string

@description('Resource group of the existing ACR (defaults to current RG)')
param existingAcrResourceGroup string = resourceGroup().name

@description('Image tag for the frontend container')
param uiImageTag string = 'v1.0.0'

@description('Image tag for the backend container')
param apiImageTag string = 'v1.0.0'

// ============================================================================
// COMPUTED VARIABLES
// ============================================================================

@description('The abbreviation for the location - must be provided in parameters')
param locationAbbreviation string

var servicePlanNameFinal = toLower('asp-${product}-${env}-${locationAbbreviation}')
var appServiceUiNameFinal = toLower('app-${customer}-${product}-ui-${env}-${locationAbbreviation}')
var appServiceApiNameFinal = toLower('app-${customer}-${product}-api-${env}-${locationAbbreviation}')

var networkSecurityGroupNameFinal = toLower(take('nsg-${customer}-${product}-${env}-${locationAbbreviation}', 80))
var routeTableNameFinal = toLower('rt-${customer}-${product}-${env}-${locationAbbreviation}')

var umiAppServiceApiNameFinal = toLower(take('umi-${customer}-${product}-${env}-api-${locationAbbreviation}', 128))
var umiAppServiceUiNameFinal = toLower(take('umi-${customer}-${product}-${env}-ui-${locationAbbreviation}', 128))

param gatewaySubnetFunctionPrefix string = 'gateway'

var minimumTlsVersion = '1.3'

// Container Registry
var acrSuffix = isGovDeployment ? 'azurecr.us' : 'azurecr.io'
var acrLoginServer = '${existingAcrName}.${acrSuffix}'

// Cloud Suffix Variables
param openAISuffix string = isGovDeployment ? 'openai.azure.us' : 'openai.azure.com'
param cognitiveServicesSuffix string = isGovDeployment
  ? 'cognitiveservices.azure.us'
  : 'cognitiveservices.azure.com'
param webSiteSuffix string = isGovDeployment ? 'azurewebsites.us' : 'azurewebsites.net'

// Private DNS Zone Names
var privateDNSZoneBlobName = 'privatelink.blob.${environment().suffixes.storage}'
var privateDNSZoneQueueName = 'privatelink.queue.${environment().suffixes.storage}'
var privateDNSZoneFileName = 'privatelink.file.${environment().suffixes.storage}'
var privateDNSZoneTableName = 'privatelink.table.${environment().suffixes.storage}'
var privateDNSZoneOpenAIName = 'privatelink.${openAISuffix}'
var privateDNSZoneCognitiveServicesName = 'privatelink.${cognitiveServicesSuffix}'
var privateDNSZoneWebName = 'privatelink.${webSiteSuffix}'

// ============================================================================
// EXISTING RESOURCES — Already deployed (compute/data only, no networking)
// ============================================================================

resource existingStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: existingStorageAccountName
  scope: resourceGroup(existingStorageAccountResourceGroup)
}

resource existingOpenAi 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: existingOpenAiName
  scope: resourceGroup(existingOpenAiResourceGroup)
}

resource existingAcr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: existingAcrName
  scope: resourceGroup(existingAcrResourceGroup)
}

// ============================================================================
// NETWORKING — NSG
// ============================================================================

module nsg 'modules/avm/res/network/network-security-group/main.bicep' = {
  name: 'Deploy-${networkSecurityGroupNameFinal}'
  params: {
    name: networkSecurityGroupNameFinal
    securityRules: []
  }
}

// ============================================================================
// NETWORKING — ROUTE TABLE
// ============================================================================

module routeTable 'modules/avm/res/network/route-table/main.bicep' = {
  name: routeTableNameFinal
  params: {
    name: routeTableNameFinal
    disableBgpRoutePropagation: true
    routes: union(
      [
        {
          name: 'default'
          properties: {
            nextHopType: 'Internet'
            addressPrefix: '0.0.0.0/0'
          }
        }
      ],
      !empty(sourceToHubAddressPrefix) && !empty(hubFirewallIPAddress)
        ? [
            {
              name: hubRoutingRuleName
              properties: {
                nextHopType: 'VirtualAppliance'
                addressPrefix: sourceToHubAddressPrefix
                nextHopIpAddress: hubFirewallIPAddress
              }
            }
          ]
        : []
    )
  }
}

// ============================================================================
// NETWORKING — VIRTUAL NETWORK
// ============================================================================

module vNet './modules/avm/res/network/virtual-network/main.bicep' = {
  scope: resourceGroup(virtualNetworkSubscriptionId, virtualNetworkResourceGroupName)
  name: 'virtualNetworkDeployment'
  params: {
    location: location
    addressPrefixes: [
      vNetAddressPrefix
    ]
    name: virtualNetworkNameFinal
    subnets: map(
      subnets,
      subnet =>
        union(subnet, {
          networkSecurityGroupResourceId: nsg.outputs.resourceId
          routeTableResourceId: contains(subnet, 'associateWithRouteTable')
            ? subnet.associateWithRouteTable ? routeTable.outputs.resourceId : null
            : null
        })
    )
  }
}

// ============================================================================
// PRIVATE DNS ZONES (all created new — no shared/existing zones)
// ============================================================================

module privateDNSZoneBlob './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneBlobName, '.', '-')}'
  params: {
    name: privateDNSZoneBlobName
  }
}

module privateDNSZoneQueue './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneQueueName, '.', '-')}'
  params: {
    name: privateDNSZoneQueueName
  }
}

module privateDNSZoneFile './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneFileName, '.', '-')}'
  params: {
    name: privateDNSZoneFileName
  }
}

module privateDNSZoneTable './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneTableName, '.', '-')}'
  params: {
    name: privateDNSZoneTableName
  }
}

module privateDNSZoneOpenAI './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneOpenAIName, '.', '-')}'
  params: {
    name: privateDNSZoneOpenAIName
  }
}

module privateDNSZoneCognitiveServices './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneCognitiveServicesName, '.', '-')}'
  params: {
    name: privateDNSZoneCognitiveServicesName
  }
}

module privateDNSZoneWeb './modules/avm/res/network/private-dns-zone/main.bicep' = {
  name: 'Deploy-DNS-${replace(privateDNSZoneWebName, '.', '-')}'
  params: {
    name: privateDNSZoneWebName
  }
}

// ============================================================================
// VNET LINKS — Link all Private DNS Zones to the VNet
// ============================================================================

module vnetLinkBlob './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-blob-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneBlob.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkQueue './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-queue-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneQueue.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkFile './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-file-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneFile.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkTable './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-table-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneTable.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkOpenAI './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-openai-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneOpenAI.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkCognitiveServices './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-cognitive-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneCognitiveServices.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkWeb './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(take('vlink-web-${virtualNetworkNameFinal}', 64))
  params: {
    privateDnsZoneName: privateDNSZoneWeb.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

// ============================================================================
// PRIVATE ENDPOINTS — Storage Account (blob, queue, file, table)
// ============================================================================

module peStorageBlob 'modules/avm/res/network/private-endpoint/main.bicep' = {
  name: toLower(take('pe-${customer}-${product}-blob-${env}-${locationAbbreviation}', 64))
  params: {
    name: toLower(take('pe-${customer}-${product}-blob-${env}-${locationAbbreviation}', 64))
    subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
    )]
    privateLinkServiceConnections: [
      {
        name: toLower('plsc-${customer}-${product}-blob-${env}')
        properties: {
          groupIds: ['blob']
          privateLinkServiceId: existingStorage.id
        }
      }
    ]
    privateDnsZoneGroup: {
      privateDnsZoneGroupConfigs: [
        {
          privateDnsZoneResourceId: privateDNSZoneBlob.outputs.resourceId
        }
      ]
    }
  }
}

module peStorageQueue 'modules/avm/res/network/private-endpoint/main.bicep' = {
  name: toLower(take('pe-${customer}-${product}-queue-${env}-${locationAbbreviation}', 64))
  params: {
    name: toLower(take('pe-${customer}-${product}-queue-${env}-${locationAbbreviation}', 64))
    subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
    )]
    privateLinkServiceConnections: [
      {
        name: toLower('plsc-${customer}-${product}-queue-${env}')
        properties: {
          groupIds: ['queue']
          privateLinkServiceId: existingStorage.id
        }
      }
    ]
    privateDnsZoneGroup: {
      privateDnsZoneGroupConfigs: [
        {
          privateDnsZoneResourceId: privateDNSZoneQueue.outputs.resourceId
        }
      ]
    }
  }
}

module peStorageFile 'modules/avm/res/network/private-endpoint/main.bicep' = {
  name: toLower(take('pe-${customer}-${product}-file-${env}-${locationAbbreviation}', 64))
  params: {
    name: toLower(take('pe-${customer}-${product}-file-${env}-${locationAbbreviation}', 64))
    subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
    )]
    privateLinkServiceConnections: [
      {
        name: toLower('plsc-${customer}-${product}-file-${env}')
        properties: {
          groupIds: ['file']
          privateLinkServiceId: existingStorage.id
        }
      }
    ]
    privateDnsZoneGroup: {
      privateDnsZoneGroupConfigs: [
        {
          privateDnsZoneResourceId: privateDNSZoneFile.outputs.resourceId
        }
      ]
    }
  }
}

module peStorageTable 'modules/avm/res/network/private-endpoint/main.bicep' = {
  name: toLower(take('pe-${customer}-${product}-table-${env}-${locationAbbreviation}', 64))
  params: {
    name: toLower(take('pe-${customer}-${product}-table-${env}-${locationAbbreviation}', 64))
    subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
    )]
    privateLinkServiceConnections: [
      {
        name: toLower('plsc-${customer}-${product}-table-${env}')
        properties: {
          groupIds: ['table']
          privateLinkServiceId: existingStorage.id
        }
      }
    ]
    privateDnsZoneGroup: {
      privateDnsZoneGroupConfigs: [
        {
          privateDnsZoneResourceId: privateDNSZoneTable.outputs.resourceId
        }
      ]
    }
  }
}

// ============================================================================
// PRIVATE ENDPOINTS — Azure OpenAI
// ============================================================================

module peOpenAi 'modules/avm/res/network/private-endpoint/main.bicep' = {
  name: toLower(take('pe-${customer}-${product}-openai-${env}-${locationAbbreviation}', 64))
  params: {
    name: toLower(take('pe-${customer}-${product}-openai-${env}-${locationAbbreviation}', 64))
    subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
    )]
    privateLinkServiceConnections: [
      {
        name: toLower('plsc-${customer}-${product}-openai-${env}')
        properties: {
          groupIds: ['account']
          privateLinkServiceId: existingOpenAi.id
        }
      }
    ]
    privateDnsZoneGroup: {
      privateDnsZoneGroupConfigs: [
        {
          privateDnsZoneResourceId: privateDNSZoneOpenAI.outputs.resourceId
        }
        {
          privateDnsZoneResourceId: privateDNSZoneCognitiveServices.outputs.resourceId
        }
      ]
    }
  }
}

// ============================================================================
// MANAGED IDENTITIES
// ============================================================================

module umiAppServiceApi 'modules/avm/res/managed-identity/user-assigned-identity/main.bicep' = {
  name: 'Deploy-UMI-API'
  params: {
    name: umiAppServiceApiNameFinal
    location: location
  }
}

module umiAppServiceUi 'modules/avm/res/managed-identity/user-assigned-identity/main.bicep' = {
  name: 'Deploy-UMI-UI'
  params: {
    name: umiAppServiceUiNameFinal
    location: location
  }
}

// ============================================================================
// RBAC — Storage Account Role Assignments (on existing resource)
// ============================================================================

module storageRoleAssignmentBlobContributor 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-storage-blob-contributor'
  params: {
    resourceId: existingStorage.id
    roleDefinitionId: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor
    principalId: umiAppServiceApi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'Storage Blob Data Contributor'
  }
}

module storageRoleAssignmentBlobOwner 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-storage-blob-owner'
  params: {
    resourceId: existingStorage.id
    roleDefinitionId: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner
    principalId: umiAppServiceApi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'Storage Blob Data Owner'
  }
}

module storageRoleAssignmentQueueContributor 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-storage-queue-contributor'
  params: {
    resourceId: existingStorage.id
    roleDefinitionId: '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
    principalId: umiAppServiceApi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'Storage Queue Data Contributor'
  }
}

// ============================================================================
// RBAC — Azure OpenAI Role Assignments (on existing resource)
// ============================================================================

module openAiRoleAssignmentContributor 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-openai-contributor'
  params: {
    resourceId: existingOpenAi.id
    roleDefinitionId: 'a001fd3d-188f-4b5d-821b-7da978bf7442' // Cognitive Services OpenAI Contributor
    principalId: umiAppServiceApi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'Cognitive Services OpenAI Contributor'
  }
}

module openAiRoleAssignmentUser 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-openai-user'
  params: {
    resourceId: existingOpenAi.id
    roleDefinitionId: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
    principalId: umiAppServiceApi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'Cognitive Services OpenAI User'
  }
}

// ============================================================================
// RBAC — ACR Pull Role Assignments (for container image pull)
// ============================================================================

module acrRoleAssignmentApi 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-acr-pull-api'
  params: {
    resourceId: existingAcr.id
    roleDefinitionId: '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
    principalId: umiAppServiceApi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'AcrPull (API)'
  }
}

module acrRoleAssignmentUi 'modules/avm/ptn/resource-role-assignment/main.bicep' = {
  name: 'rbac-acr-pull-ui'
  params: {
    resourceId: existingAcr.id
    roleDefinitionId: '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
    principalId: umiAppServiceUi.outputs.principalId
    principalType: 'ServicePrincipal'
    roleName: 'AcrPull (UI)'
  }
}

// ============================================================================
// APP SERVICE PLAN
// ============================================================================

module plan 'modules/avm/res/web/serverfarm/main.bicep' = {
  name: servicePlanNameFinal
  params: {
    name: servicePlanNameFinal
    skuName: skuNameAppServicePlan
    reserved: true
    kind: 'linux'
    skuCapacity: serverFarmSkuCapacity
  }
}

// ============================================================================
// FRONTEND APP SERVICE (React/Vite)
// ============================================================================

module appServiceUi 'modules/avm/res/web/site/main.bicep' = {
  name: appServiceUiNameFinal
  params: {
    name: appServiceUiNameFinal
    kind: 'app,linux'
    serverFarmResourceId: plan.outputs.resourceId
    managedIdentities: {
      userAssignedResourceIds: [
        umiAppServiceUi.outputs.resourceId
      ]
    }
    virtualNetworkSubnetId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-web'
    )]
    httpsOnly: httpsOnly
    publicNetworkAccess: publicNetworkAccessUIAppService
    vnetRouteAllEnabled: vnetRouteAllEnabled
    vnetContentShareEnabled: vnetContentShareEnabled
    vnetImagePullEnabled: vnetImagePullEnabled
    privateEndpoints: [
      {
        name: toLower(take('pe-${customer}-${product}-ui-${env}-${locationAbbreviation}', 64))
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: privateDNSZoneWeb.outputs.resourceId
            }
          ]
        }
      }
    ]
    siteConfig: {
      minTlsVersion: minimumTlsVersion
      linuxFxVersion: 'DOCKER|${acrLoginServer}/swft-frontend:${uiImageTag}'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: umiAppServiceUi.outputs.clientId
      http20Enabled: true
      alwaysOn: false
      logsConfiguration: {
        applicationLogs: {
          fileSystem: {
            level: 'Verbose'
          }
        }
        detailedErrorMessages: {
          enabled: true
        }
        failedRequestsTracing: {
          enabled: true
        }
        httpLogs: {
          fileSystem: {
            retentionInDays: 7
            retentionInMb: 100
            enabled: true
          }
        }
      }
      appSettings: [
        {
          name: 'API_BACKEND_URL'
          value: 'https://${appServiceApiNameFinal}.${webSiteSuffix}'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${acrLoginServer}'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
      ]
    }
  }
}

// ============================================================================
// BACKEND APP SERVICE (FastAPI/Python)
// ============================================================================

module appServiceApi 'modules/avm/res/web/site/main.bicep' = {
  name: appServiceApiNameFinal
  params: {
    name: appServiceApiNameFinal
    kind: 'app,linux'
    serverFarmResourceId: plan.outputs.resourceId
    httpsOnly: httpsOnly
    publicNetworkAccess: publicNetworkAccess
    vnetRouteAllEnabled: vnetRouteAllEnabled
    vnetContentShareEnabled: vnetContentShareEnabled
    vnetImagePullEnabled: vnetImagePullEnabled
    managedIdentities: {
      userAssignedResourceIds: [
        umiAppServiceApi.outputs.resourceId
      ]
    }
    virtualNetworkSubnetId: vNet.outputs.subnetResourceIds[indexOf(
      vNet.outputs.subnetNames,
      '${subnetNamePrefixFinal}-web'
    )]
    keyVaultAccessIdentityResourceId: umiAppServiceApi.outputs.resourceId
    privateEndpoints: [
      {
        name: toLower(take('pe-${customer}-${product}-api-${env}-${locationAbbreviation}', 64))
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: privateDNSZoneWeb.outputs.resourceId
            }
          ]
        }
      }
    ]
    siteConfig: {
      minTlsVersion: minimumTlsVersion
      linuxFxVersion: 'DOCKER|${acrLoginServer}/swft-backend:${apiImageTag}'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: umiAppServiceApi.outputs.clientId
      http20Enabled: true
      alwaysOn: false
      logsConfiguration: {
        applicationLogs: {
          fileSystem: {
            level: 'Verbose'
          }
        }
        detailedErrorMessages: {
          enabled: true
        }
        failedRequestsTracing: {
          enabled: true
        }
        httpLogs: {
          fileSystem: {
            retentionInDays: 7
            retentionInMb: 100
            enabled: true
          }
        }
      }
      appSettings: [
        {
          name: 'AZURE_CLIENT_ID'
          value: umiAppServiceApi.outputs.clientId
        }
        {
          name: 'AZURE_STORAGE_ACCOUNT'
          value: existingStorageAccountName
        }
        {
          name: 'AZURE_STORAGE_ENDPOINT_SUFFIX'
          value: environment().suffixes.storage
        }
        {
          name: 'OPENAI_PROVIDER'
          value: 'azure'
        }
        {
          name: 'OPENAI_API_BASE'
          value: 'https://${existingOpenAiName}.${openAISuffix}/'
        }
        {
          name: 'OPENAI_API_VERSION'
          value: openAiApiVersion
        }
        {
          name: 'OPENAI_USE_MANAGED_IDENTITY'
          value: 'true'
        }
        {
          name: 'OPENAI_MODEL_NAME'
          value: openAiChatDeploymentName
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: 'https://${existingOpenAiName}.${openAISuffix}/'
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: openAiChatDeploymentName
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${acrLoginServer}'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8000'
        }
      ]
    }
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

output uiAppServiceName string = appServiceUi.outputs.name
output uiAppServiceUrl string = 'https://${appServiceUi.outputs.defaultHostname}'
output apiAppServiceName string = appServiceApi.outputs.name
output apiAppServiceUrl string = 'https://${appServiceApi.outputs.defaultHostname}'
output vnetName string = vNet.outputs.name
output vnetResourceId string = vNet.outputs.resourceId
output umiApiPrincipalId string = umiAppServiceApi.outputs.principalId
output umiApiClientId string = umiAppServiceApi.outputs.clientId
output umiUiPrincipalId string = umiAppServiceUi.outputs.principalId
