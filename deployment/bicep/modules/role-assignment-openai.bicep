param env string
param roleAssignmentName string
param roleDefinitionId string
param principalId string
param openAiName string


resource openAi 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' existing = {
  name : openAiName
}

// Cognitive Services OpenAI User
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2020-04-01-preview' = {
  name: roleAssignmentName
  scope: openAi
  properties: {
    roleDefinitionId: roleDefinitionId
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services OpenAI Contributor
resource roleAssignment1 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid('Cognitive Services OpenAI Contributor', env, openAiName)
  scope: openAi
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a001fd3d-188f-4b5d-821b-7da978bf7442'
    )
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
