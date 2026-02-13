using '../../main.scai.bicep'

param isGovDeployment = true
param env = 'DEV'
param customer = 'fedairs'
param product = 'scai'
param locationAbbreviation = 'va'

// ============================================================================
// NETWORKING CONFIGURATION
// ============================================================================
// 
// IMPORTANT: Double-check IP address ranges (VNet/Subnet) are approved and available
// for use in the target cloud environment before deployment. Verify with network team
// that the addresses do not conflict with existing allocations.
//

// Virtual Network Configuration
param virtualNetworkNameFinal = toLower('vnet-${customer}-${product}-${env}-${locationAbbreviation}')
param vNetAddressPrefix = '10.1.0.0/16'
param subnetNamePrefixFinal = toLower('snet-${customer}-${product}-${env}gov-${env}')
param subnets = [
  {
    function: 'gateway'
    name: take('${subnetNamePrefixFinal}-gateway', 80)
    addressPrefix: '10.1.1.0/26'
  }
  {
    function: 'web'
    name: take('${subnetNamePrefixFinal}-web', 80)
    addressPrefix: '10.1.2.0/26'
    delegation: 'Microsoft.Web/serverFarms'
  }
  {
    function: 'services'
    name: take('${subnetNamePrefixFinal}-services', 80)
    addressPrefix: '10.1.3.0/26'
  }
]

// Private DNS Zone Configuration
// Creating our own Private DNS Zones instead of using shared ones
param useExistingPrivateDNSZones = false
//param existingPrivateDNSZoneResourceGroup = toLower('rg-${customer}-${product}-${buildSpokeName}-${env}gov-${locationAbbreviation}')

// VNet Peering Configuration
param shouldPeerWithHub = false
// If peering with hub, uncomment and configure:
// param hubSubscriptionId = '<hub-subscription-id>'
// param hubResourceGroupName = '<hub-resource-group-name>'
// param hubVirtualNetworkName = '<hub-vnet-name>'

// Build Spoke Configuration - DISABLED
param shouldPeerWithBuildVNet = false
// param buildResourceGroupName = toLower('rg-${customer}-${product}-${buildSpokeName}-${env}gov-${locationAbbreviation}')
// param buildVirtualNetworkName = toLower('vnet-${customer}-${product}-${buildSpokeName}-${env}-${locationAbbreviation}')

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

// Network Security - All resources private by default
param publicNetworkAccess = 'Disabled'
param publicNetworkAccessUIAppService = 'Enabled' // UI can be publicly accessible
param httpsOnly = true
param vnetRouteAllEnabled = true
param vnetContentShareEnabled = true
param vnetImagePullEnabled = true

// ============================================================================
// STORAGE ACCOUNT CONFIGURATION
// ============================================================================

param storageContainerNames = ['artifacts', 'runs', 'sboms', 'scans']
param shouldAllowBlobPublicAccess = false
param allowPublicNetworkAccessStorage = false
param shouldAllowStorageSharedKeyAccess = false

// ============================================================================
// AZURE OPENAI CONFIGURATION
// ============================================================================

param useExistingOpenAi = false
param shouldRestoreSoftDeletedOpenAI = false
param openAiSku = 'S0'
param openAiChatDeploymentName = 'gpt-4o'
param openAiApiVersion = '2024-10-21'
param disableLocalAuth = true
param dynamicThrottlingEnabledOpenAI = false

var chatGptDeploymentCapacity = 80

var chatGpt = {
  modelName: 'gpt-4o'
  deploymentName: openAiChatDeploymentName
  deploymentVersion: '2024-11-20'
  deploymentCapacity: chatGptDeploymentCapacity
}

param openAiDeployments = [
  {
    name: chatGpt.deploymentName
    model: {
      format: 'OpenAI'
      name: chatGpt.modelName
      version: chatGpt.deploymentVersion
    }
    sku: {
      name: 'Standard'
      capacity: chatGpt.deploymentCapacity
    }
  }
]

// ============================================================================
// APP SERVICE CONFIGURATION
// ============================================================================

param skuNameAppServicePlan = 'B2'
param serverFarmSkuCapacity = 1

