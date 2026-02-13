param isGovDeployment bool
param customer string
param product string

param keyVaultName string
param umiPrincipalName string
param umiPrincipalApplicationGatewayName string

var appServiceResourceProviderGUID = isGovDeployment ? '17b073fa-1a96-400c-83f1-65e8a5c09e9b' : 'cc7b8e5f-a3c1-4997-a78f-f6ebeef6fd2a' //Application ID's for US Gov and Cloud are, but it needs the object (principal) ID's: '6a02c803-dafd-4136-b4c3-5a6f318b4714' : 'abfa0a7c-a6b6-4736-8310-5855508787cd'

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: keyVaultName
}

resource umiPrincipalAPIAppService 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: umiPrincipalName
}

resource umiPrincipalApplicationGateway 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = if(!empty(umiPrincipalApplicationGatewayName)) {
  name: umiPrincipalApplicationGatewayName
}

resource roleAssignmentKeyVault 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(customer, product, subscription().subscriptionId, resourceGroup().name, keyVault.id, umiPrincipalAPIAppService.id, 'Key Vault Secrets User')
  properties: {
    principalType: 'ServicePrincipal'
    principalId: umiPrincipalAPIAppService.properties.principalId
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    ) // Key Vault Secrets User Role
  }
  scope: keyVault
}

resource roleAssignmentAppServiceResourceProvider 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(customer, product, subscription().subscriptionId, resourceGroup().name, keyVault.id, appServiceResourceProviderGUID, 'Key Vault Certificate User')
  properties: {
    principalType: 'ServicePrincipal'
    principalId: appServiceResourceProviderGUID // App Service Resource Provider (see https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-certificate?tabs=apex%2Crbac%2Cazure-cli#authorize-app-service-to-read-from-the-vault)
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'db79e9a7-68ee-4b58-9aeb-b90e7c24fcba'
    ) // Key Vault Certificate User
  }
  scope: keyVault
}

resource roleAssignmentAppServiceResourceProviderCertificatesOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(!empty(umiPrincipalApplicationGatewayName)) {
  name: guid(customer, product, subscription().subscriptionId, resourceGroup().name, keyVault.id, umiPrincipalApplicationGateway.id, 'Key Vault Secrets User')
  properties: {
    principalType: 'ServicePrincipal'
    principalId: umiPrincipalApplicationGateway.?properties.?principalId // UMI for the Application Gateway
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    ) // Key Vault Secrets User (used even though it's actually fetching the TLS certificate)
  }
  scope: keyVault
}
