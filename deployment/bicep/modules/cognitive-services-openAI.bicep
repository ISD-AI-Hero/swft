param env string
param managedIdentityPrincipalId string
param shouldRestoreSoftDeletedOpenAI bool
param suffix string = uniqueString(resourceGroup().id)
metadata description = 'Creates an Azure Cognitive Services instance.'
param name string
param location string = resourceGroup().location
param tags object = {}
@description('The custom subdomain name used to access the API. Defaults to the value of the name parameter.')
param customSubDomainName string = name
param deployments array = []
param kind string = 'OpenAI'

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

param useExistingOpenAi bool = false
param disableLocalAuth bool = true

resource existingAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' existing =
  if (useExistingOpenAi) {
    name: name
  }

resource account 'Microsoft.CognitiveServices/accounts@2023-05-01' =
  if (!useExistingOpenAi) {
    name: name
    location: location
    tags: tags
    kind: kind
    properties: {
      customSubDomainName: customSubDomainName
      publicNetworkAccess: publicNetworkAccess
      networkAcls: networkAcls
      disableLocalAuth: disableLocalAuth
      restore: shouldRestoreSoftDeletedOpenAI
    }
    sku: sku
  }

@batchSize(1)
resource deploymentExisting 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = [
  for deployment in deployments: if (useExistingOpenAi) {
    parent: existingAccount
    name: deployment.name
    properties: {
      model: deployment.model
      raiPolicyName: contains(deployment, 'raiPolicyName') ? deployment.raiPolicyName : null
    }
    sku: contains(deployment, 'sku')
      ? deployment.sku
      : {
          name: 'Standard'
          capacity: 1
        }
  }
]

@batchSize(1)
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = [
  for deployment in deployments: if (!useExistingOpenAi) {
    parent: account
    name: deployment.name
    properties: {
      model: deployment.model
      raiPolicyName: contains(deployment, 'raiPolicyName') ? deployment.raiPolicyName : null
    }
    sku: contains(deployment, 'sku')
      ? deployment.sku
      : {
          name: 'Standard'
          capacity: 1
        }
  }
]

// Cognitive Services OpenAI Contributor
resource roleAssignment1 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(!useExistingOpenAi) {
  name: guid('Cognitive Services OpenAI Contributor', suffix, env, name)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a001fd3d-188f-4b5d-821b-7da978bf7442'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services OpenAI User
resource roleAssignment2 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(!useExistingOpenAi) {
  name: guid('Cognitive Services OpenAI User', suffix, env, name)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services OpenAI Contributor
resource roleAssignment1Existing 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(useExistingOpenAi) {
  name: guid('Cognitive Services OpenAI Contributor', env, name)
  scope: existingAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a001fd3d-188f-4b5d-821b-7da978bf7442'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services OpenAI User
resource roleAssignment2Existing 'Microsoft.Authorization/roleAssignments@2022-04-01' = if(useExistingOpenAi) {
  name: guid('Cognitive Services OpenAI User', env, name)
  scope: existingAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output endpoint string = account.properties.endpoint
output id string = account.id
output name string = account.name
