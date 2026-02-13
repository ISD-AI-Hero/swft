targetScope = 'resourceGroup'

param location string = resourceGroup().location

@allowed(['DEV', 'UAT', 'TEST', 'PROD', 'SBX'])
param env string

param customer string

param product string = 'scai'

// Networking Configuration
param virtualNetworkSubscriptionId string = subscription().subscriptionId
param virtualNetworkResourceGroupName string = resourceGroup().name
param virtualNetworkNameFinal string
param vNetAddressPrefix string = '10.0.0.0/16'
param subnetNamePrefixFinal string
param gatewaySubnetFunctionPrefix string = 'gateway'

param subnets array = []

// Private DNS Zone Configuration
param useExistingPrivateDNSZones bool = true
param existingPrivateDNSZoneSubscriptionId string = subscription().subscriptionId
param existingPrivateDNSZoneResourceGroup string = resourceGroup().name

param shouldPeerWithHub bool = false
param hubSubscriptionId string = subscription().subscriptionId
param hubResourceGroupName string = ''
param hubVirtualNetworkName string = ''

param shouldPeerWithBuildVNet bool = false
param buildSubscriptionId string = subscription().subscriptionId
param buildResourceGroupName string = ''
param buildVirtualNetworkName string = ''
param shouldLinkBuildVnetToPrivateDNSZones bool = !useExistingPrivateDNSZones && shouldPeerWithBuildVNet

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

// App Service Configuration
param skuNameAppServicePlan string = 'B2'
param serverFarmSkuCapacity int = 1
param isGovDeployment bool = true

// Azure OpenAI Configuration
param openAiSubscriptionId string = subscription().subscriptionId
param openAiResourceGroup string = resourceGroup().name
param useExistingOpenAi bool = false
param shouldRestoreSoftDeletedOpenAI bool = false
param existingOpenAIName string = ''
param openAiSku string = 'S0'
param openAiChatDeploymentName string = 'gpt-4o'
param openAiApiVersion string = '2024-10-21'
param openAiDeployments array = []
param disableLocalAuth bool = true
param dynamicThrottlingEnabledOpenAI bool = false

// Storage Account Configuration
param storageContainerNames array = ['artifacts', 'runs', 'sboms', 'scans']
param shouldAllowBlobPublicAccess bool = false
param allowPublicNetworkAccessStorage bool = false
param shouldAllowStorageSharedKeyAccess bool = false

// Computed Variables
@description('The abbreviation for the location - must be provided in parameters')
param locationAbbreviation string

var servicePlanNameFinal = toLower('asp-${product}-${env}-${locationAbbreviation}')
var appServiceUiNameFinal = toLower('app-${customer}-${product}-ui-${env}-${locationAbbreviation}')
var appServiceApiNameFinal = toLower('app-${customer}-${product}-api-${env}-${locationAbbreviation}')
var storageAccountNameFinal = take(toLower(replace('stg${customer}${product}${env}${locationAbbreviation}', '-', '')), 24)
var openAiNameFinal = useExistingOpenAi
  ? existingOpenAIName
  : toLower(take(
      'aoai-${customer}-${product}-${env}-${locationAbbreviation}-${uniqueString(subscription().subscriptionId, resourceGroup().name, customer, product, env, locationAbbreviation)}',
      64
    ))

var networkSecurityGroupNameFinal = toLower(take('nsg-${customer}-${product}-${env}-${locationAbbreviation}', 80))
var routeTableNameFinal = toLower('rt-${customer}-${product}-${env}-${locationAbbreviation}')

var umiAppServiceApiNameFinal = toLower(take('umi-${customer}-${product}-${env}-api-${locationAbbreviation}', 128))
var umiAppServiceUiNameFinal = toLower(take('umi-${customer}-${product}-${env}-ui-${locationAbbreviation}', 128))

var minimumTlsVersion = '1.3'

// Cloud Suffix Variables
param openAISuffix string = isGovDeployment ? 'openai.azure.us' : 'openai.azure.com'
param cognitiveServicesSuffix string = isGovDeployment
  ? 'cognitiveservices.azure.us'
  : 'cognitiveservices.azure.com'
param webSiteSuffix string = isGovDeployment ? 'azurewebsites.us' : 'azurewebsites.net'

// Private DNS Zone Names
var privateDnsZoneSubscriptionId = useExistingPrivateDNSZones
  ? existingPrivateDNSZoneSubscriptionId
  : !empty(existingPrivateDNSZoneSubscriptionId) ? existingPrivateDNSZoneSubscriptionId : subscription().subscriptionId
var privateDnsZoneResourceGroupName = useExistingPrivateDNSZones
  ? existingPrivateDNSZoneResourceGroup
  : !empty(existingPrivateDNSZoneResourceGroup) ? existingPrivateDNSZoneResourceGroup : resourceGroup().name

var privateDNSZoneBlobName = 'privatelink.blob.${environment().suffixes.storage}'
var privateDNSZoneQueueName = 'privatelink.queue.${environment().suffixes.storage}'
var privateDNSZoneFileName = 'privatelink.file.${environment().suffixes.storage}'
var privateDNSZoneTableName = 'privatelink.table.${environment().suffixes.storage}'
var privateDNSZoneOpenAIName = 'privatelink.${openAISuffix}'
var privateDNSZoneCognitiveServicesName = 'privatelink.${cognitiveServicesSuffix}'
var privateDNSZoneWebName = 'privatelink.${webSiteSuffix}'

// ============================================================================
// EXISTING RESOURCES
// ============================================================================

resource hubVNet 'Microsoft.Network/virtualNetworks@2024-03-01' existing = if (shouldPeerWithHub) {
  name: hubVirtualNetworkName
  scope: resourceGroup(hubSubscriptionId, hubResourceGroupName)
}

resource buildVNet 'Microsoft.Network/virtualNetworks@2024-03-01' existing = if (shouldPeerWithBuildVNet) {
  name: buildVirtualNetworkName
  scope: resourceGroup(buildSubscriptionId, buildResourceGroupName)
}

// ============================================================================
// NETWORKING RESOURCES
// ============================================================================

module nsg 'modules/avm/res/network/network-security-group/main.bicep' = {
  name: 'Deploy-${networkSecurityGroupNameFinal}'
  params: {
    name: networkSecurityGroupNameFinal
    securityRules: []
  }
}

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
    peerings: union(
      shouldPeerWithHub
        ? [
            {
              remoteVirtualNetworkResourceId: hubVNet.id
              remotePeeringEnabled: true
            }
          ]
        : [],
      shouldPeerWithBuildVNet
        ? [
            {
              remoteVirtualNetworkResourceId: buildVNet.id
              remotePeeringEnabled: true
            }
          ]
        : []
    )
  }
}

// ============================================================================
// PRIVATE DNS ZONES
// ============================================================================

// Storage Blob
resource privateDNSZoneBlobExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneBlobName
}

module privateDNSZoneBlob './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneBlobName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneBlobName
  }
}

// Storage Queue
resource privateDNSZoneQueueExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneQueueName
}

module privateDNSZoneQueue './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneQueueName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneQueueName
  }
}

// Storage File
resource privateDNSZoneFileExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneFileName
}

module privateDNSZoneFile './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneFileName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneFileName
  }
}

// Storage Table
resource privateDNSZoneTableExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneTableName
}

module privateDNSZoneTable './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneTableName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneTableName
  }
}

// OpenAI
resource privateDNSZoneOpenAIExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneOpenAIName
}

module privateDNSZoneOpenAI './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneOpenAIName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneOpenAIName
  }
}

// Cognitive Services (for OpenAI fallback)
resource privateDNSZoneCognitiveServicesExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneCognitiveServicesName
}

module privateDNSZoneCognitiveServices './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneCognitiveServicesName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneCognitiveServicesName
  }
}

// Web (App Services)
resource privateDNSZoneWebExisting 'Microsoft.Network/privateDnsZones@2024-06-01' existing = if (useExistingPrivateDNSZones) {
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  name: privateDNSZoneWebName
}

module privateDNSZoneWeb './modules/avm/res/network/private-dns-zone/main.bicep' = if (!useExistingPrivateDNSZones) {
  name: privateDNSZoneWebName
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    name: privateDNSZoneWebName
  }
}

// ============================================================================
// VNET LINKS FOR PRIVATE DNS ZONES
// ============================================================================

module vnetLinkStorageBlob './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneBlobExisting.name : privateDNSZoneBlob.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones ? privateDNSZoneBlobExisting.name : privateDNSZoneBlob.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkStorageQueue './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneQueueExisting.name : privateDNSZoneQueue.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones ? privateDNSZoneQueueExisting.name : privateDNSZoneQueue.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkStorageFile './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneFileExisting.name : privateDNSZoneFile.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones ? privateDNSZoneFileExisting.name : privateDNSZoneFile.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkStorageTable './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneTableExisting.name : privateDNSZoneTable.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones ? privateDNSZoneTableExisting.name : privateDNSZoneTable.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkOpenAI './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneOpenAIExisting.name : privateDNSZoneOpenAI.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones
      ? privateDNSZoneOpenAIExisting.name
      : privateDNSZoneOpenAI.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkCognitiveServices './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneCognitiveServicesExisting.name : privateDNSZoneCognitiveServices.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones
      ? privateDNSZoneCognitiveServicesExisting.name
      : privateDNSZoneCognitiveServices.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkWeb './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = {
  name: toLower(replace(
    take(
      'vlink-${virtualNetworkNameFinal}-${useExistingPrivateDNSZones ? privateDNSZoneWebExisting.name : privateDNSZoneWeb.name}',
      64
    ),
    '.',
    '-'
  ))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: useExistingPrivateDNSZones ? privateDNSZoneWebExisting.name : privateDNSZoneWeb.outputs.name
    virtualNetworkResourceId: vNet.outputs.resourceId
  }
}

module vnetLinkWebBuildVNet './modules/avm/res/network/private-dns-zone/virtual-network-link/main.bicep' = if (shouldLinkBuildVnetToPrivateDNSZones) {
  name: toLower(replace(take('vlink-${buildVNet.name}-${privateDNSZoneWeb.name}', 64), '.', '-'))
  scope: resourceGroup(privateDnsZoneSubscriptionId, privateDnsZoneResourceGroupName)
  params: {
    privateDnsZoneName: privateDNSZoneWeb.outputs.name
    virtualNetworkResourceId: buildVNet.id
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
// MONITORING RESOURCES
// ============================================================================

// ============================================================================
// STORAGE ACCOUNT
// ============================================================================

module storage 'modules/avm/res/storage/storage-account/main.bicep' = {
  name: 'deployStorageAccount'
  params: {
    location: location
    name: storageAccountNameFinal
    kind: 'StorageV2'
    skuName: 'Standard_LRS'
    allowBlobPublicAccess: shouldAllowBlobPublicAccess
    allowSharedKeyAccess: shouldAllowStorageSharedKeyAccess
    publicNetworkAccess: allowPublicNetworkAccessStorage ? 'Enabled' : 'Disabled'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    blobServices: {
      containers: map(storageContainerNames, name => {
        name: name
        publicAccess: 'None'
      })
    }
    queueServices: {
      queues: []
    }
    privateEndpoints: [
      {
        name: toLower(take('pe-${customer}-${product}-blob-${env}-${locationAbbreviation}', 64))
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        service: 'blob'
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneBlobExisting.id
                : privateDNSZoneBlob.outputs.resourceId
            }
          ]
        }
      }
      {
        name: toLower('pe-${customer}-${product}-queue-${env}')
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        service: 'queue'
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneQueueExisting.id
                : privateDNSZoneQueue.outputs.resourceId
            }
          ]
        }
      }
      {
        name: toLower('pe-${customer}-${product}-file-${env}')
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        service: 'file'
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneFileExisting.id
                : privateDNSZoneFile.outputs.resourceId
            }
          ]
        }
      }
      {
        name: toLower('pe-${customer}-${product}-table-${env}')
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        service: 'table'
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneTableExisting.id
                : privateDNSZoneTable.outputs.resourceId
            }
          ]
        }
      }
    ]
    roleAssignments: [
      {
        name: guid('Storage Blob Data Contributor', customer, product, env, umiAppServiceApi.outputs.name)
        principalId: umiAppServiceApi.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor
        )
      }
      {
        name: guid('Storage Blob Data Owner', customer, product, env, umiAppServiceApi.outputs.name)
        principalId: umiAppServiceApi.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner
        )
      }
      {
        name: guid('Storage Queue Data Contributor', customer, product, env, umiAppServiceApi.outputs.name)
        principalId: umiAppServiceApi.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
        )
      }
    ]
  }
}

// ============================================================================
// AZURE OPENAI
// ============================================================================

module openAi 'modules/avm/res/cognitive-services/account/main.bicep' = {
  name: openAiNameFinal
  scope: resourceGroup(openAiSubscriptionId, openAiResourceGroup)
  params: {
    useExistingAccount: useExistingOpenAi
    name: openAiNameFinal
    kind: 'OpenAI'
    sku: openAiSku
    restore: shouldRestoreSoftDeletedOpenAI
    deployments: openAiDeployments
    disableLocalAuth: disableLocalAuth
    customSubDomainName: openAiNameFinal
    dynamicThrottlingEnabled: dynamicThrottlingEnabledOpenAI
    publicNetworkAccess: publicNetworkAccess
    privateEndpoints: [
      {
        name: toLower(take('pe-${openAiNameFinal}', 64))
        subnetResourceId: vNet.outputs.subnetResourceIds[indexOf(
          vNet.outputs.subnetNames,
          '${subnetNamePrefixFinal}-${gatewaySubnetFunctionPrefix}'
        )]
        privateDnsZoneGroup: {
          privateDnsZoneGroupConfigs: [
            {
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneOpenAIExisting.id
                : privateDNSZoneOpenAI.outputs.resourceId
            }
          ]
        }
      }
    ]
    roleAssignments: [
      {
        name: guid(
          'Cognitive Services OpenAI Contributor',
          resourceGroup().id,
          env,
          openAiNameFinal,
          umiAppServiceApi.outputs.name
        )
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          'a001fd3d-188f-4b5d-821b-7da978bf7442' // Cognitive Services OpenAI Contributor
        )
        principalId: umiAppServiceApi.outputs.principalId
        principalType: 'ServicePrincipal'
      }
      {
        name: guid(
          'Cognitive Services OpenAI User',
          resourceGroup().id,
          env,
          openAiNameFinal,
          umiAppServiceApi.outputs.name
        )
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
        )
        principalId: umiAppServiceApi.outputs.principalId
        principalType: 'ServicePrincipal'
      }
    ]
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
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneWebExisting.id
                : privateDNSZoneWeb.outputs.resourceId
            }
          ]
        }
      }
    ]
    siteConfig: {
      minTlsVersion: minimumTlsVersion
      linuxFxVersion: 'NODE|20-lts'
      nodeVersion: '20-lts'
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
          name: 'VITE_API_URL'
          value: 'https://${appServiceApiNameFinal}.${webSiteSuffix}'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
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
              privateDnsZoneResourceId: useExistingPrivateDNSZones
                ? privateDNSZoneWebExisting.id
                : privateDNSZoneWeb.outputs.resourceId
            }
          ]
        }
      }
    ]
    siteConfig: {
      minTlsVersion: minimumTlsVersion
      linuxFxVersion: 'PYTHON|3.11'
      http20Enabled: true
      alwaysOn: false
      cors: {
        allowedOrigins: [
          'https://${appServiceUiNameFinal}.${webSiteSuffix}'
        ]
      }
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
          name: 'AZURE_STORAGE_ACCOUNT_NAME'
          value: storage.outputs.name
        }
        {
          name: 'AZURE_STORAGE_ENDPOINT_SUFFIX'
          value: environment().suffixes.storage
        }
        {
          name: 'OPENAI_API_BASE'
          value: openAi.outputs.endpoint
        }
        {
          name: 'OPENAI_API_VERSION'
          value: openAiApiVersion
        }
        {
          name: 'OPENAI_MODEL_NAME'
          value: openAiChatDeploymentName
        }
        {
          name: 'OPENAI_ENDPOINT'
          value: openAi.outputs.endpoint
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: openAi.outputs.endpoint
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: openAiChatDeploymentName
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
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
output storageAccountName string = storage.outputs.name
output openAiName string = openAi.outputs.name
output openAiEndpoint string = openAi.outputs.endpoint
output vnetName string = vNet.outputs.name
output vnetResourceId string = vNet.outputs.resourceId
output umiApiPrincipalId string = umiAppServiceApi.outputs.principalId
output umiUiPrincipalId string = umiAppServiceUi.outputs.principalId
