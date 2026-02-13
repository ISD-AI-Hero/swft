param managedIdentityPrincipalId string
param env string
param suffix string = uniqueString(resourceGroup().id)
metadata description = 'Creates an Azure Document Intelligence (form recognizer) instance.'

param name string
param location string = resourceGroup().location

@description('The custom subdomain name used to access the API. Defaults to the value of the name parameter.')
param customSubDomainName string = name
param kind string = 'FormRecognizer'

@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'
param sku object = {
  name: 'S0'
}

param allowedIpRules array = []
param networkAcls object = empty(allowedIpRules)
  ? {
      defaultAction: 'Allow'
    }
  : {
      ipRules: allowedIpRules
      defaultAction: 'Deny'
    }


param useExistingDocIntel bool = false
param disableLocalAuth bool = true
param restore bool


resource existingAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' existing =
  if (useExistingDocIntel) {
    name: name
  }

resource account 'Microsoft.CognitiveServices/accounts@2023-05-01' =
  if (!useExistingDocIntel) {
    name: name
    location: location
    kind: kind
    properties: {
      customSubDomainName: customSubDomainName
      publicNetworkAccess: publicNetworkAccess
      networkAcls: networkAcls
      disableLocalAuth: disableLocalAuth
      restore: restore
    }
    sku: sku
  }




// Cognitive Services User
resource roleAssignment1 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(!useExistingDocIntel) {
  name: guid('Cognitive Services User', suffix, env, name)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a97b65f3-24c7-4388-baec-2e87135dc908'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}


resource roleAssignment1existing 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(useExistingDocIntel) {
  name: guid('Cognitive Services User', suffix, env, name)
  scope: existingAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a97b65f3-24c7-4388-baec-2e87135dc908'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}


output endpoint string = account.properties.endpoint
