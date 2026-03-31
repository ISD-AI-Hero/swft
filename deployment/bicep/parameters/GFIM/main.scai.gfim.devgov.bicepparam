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
param vNetAddressPrefix = '10.0.0.0/16'
param subnetNamePrefixFinal = toLower('snet-${customer}-${product}-${env}gov-${env}')
// NOTE: Address space starts at x.x.2.0/26 because Azure Firewall is reserving x.x.0.0/26 and x.x.1.0/26

param subnets = [
  {
    function: 'gateway'
    name: take('${subnetNamePrefixFinal}-gateway', 80)
    addressPrefix: '10.0.1.0/27'
  }
  {
    function: 'web'
    name: take('${subnetNamePrefixFinal}-web', 80)
    addressPrefix: '10.0.1.32/27'
    delegation: 'Microsoft.Web/serverFarms'
  }
  {
    function: 'services'
    name: take('${subnetNamePrefixFinal}-services', 80)
    addressPrefix: '10.0.1.64/28'
  }
]

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

// Network Security — All resources private by default
param publicNetworkAccess = 'Disabled'
param publicNetworkAccessUIAppService = 'Enabled' // UI can be publicly accessible
param httpsOnly = true
param vnetRouteAllEnabled = true
param vnetContentShareEnabled = true
param vnetImagePullEnabled = true

// ============================================================================
// EXISTING RESOURCE REFERENCES
// ============================================================================

// TODO: Replace with actual resource names from your environment
param existingStorageAccountName = 'scaistg'
param existingOpenAiName = 'SCAI-AI'

// TODO: Replace with actual ACR name from your environment
param existingAcrName = 'scaicr'

// Uncomment if resources are in a different resource group:
// param existingStorageAccountResourceGroup = '<storage-rg-name>'
// param existingOpenAiResourceGroup = '<openai-rg-name>'
// param existingSqlServerResourceGroup = '<sql-rg-name>'

// ============================================================================
// AZURE OPENAI CONFIGURATION (app settings only)
// ============================================================================

param openAiChatDeploymentName = 'gpt-4o'
param openAiApiVersion = '2024-10-21'

// ============================================================================
// APP SERVICE CONFIGURATION
// ============================================================================

param skuNameAppServicePlan = 'B2'
param serverFarmSkuCapacity = 1
