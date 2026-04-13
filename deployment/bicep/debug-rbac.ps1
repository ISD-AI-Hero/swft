# Debug RBAC Authorization Failure
# Run each command to diagnose why role assignments are failing

# 1. Confirm your identity
Write-Host "`n=== Current Identity ===" -ForegroundColor Cyan
az ad signed-in-user show --query "{upn:userPrincipalName, objectId:id}" -o table

# 2. Check roles on the resource group
Write-Host "`n=== Roles on rg-SCAI-Demo ===" -ForegroundColor Cyan
az role assignment list `
  --assignee khoaquach@gfim.onmicrosoft.us `
  --scope /subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754/resourceGroups/rg-SCAI-Demo `
  --query "[].{role:roleDefinitionName, scope:scope}" -o table

# 3. Check roles on storage account specifically
Write-Host "`n=== Roles on scaistg ===" -ForegroundColor Cyan
az role assignment list `
  --assignee khoaquach@gfim.onmicrosoft.us `
  --scope /subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754/resourceGroups/rg-SCAI-Demo/providers/Microsoft.Storage/storageAccounts/scaistg `
  --query "[].{role:roleDefinitionName, scope:scope}" -o table

# 4. Check roles on OpenAI
Write-Host "`n=== Roles on SCAI-AI ===" -ForegroundColor Cyan
az role assignment list `
  --assignee khoaquach@gfim.onmicrosoft.us `
  --scope /subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754/resourceGroups/rg-SCAI-Demo/providers/Microsoft.CognitiveServices/accounts/SCAI-AI `
  --query "[].{role:roleDefinitionName, scope:scope}" -o table

# 5. Check roles on ACR
Write-Host "`n=== Roles on scaicr ===" -ForegroundColor Cyan
az role assignment list `
  --assignee khoaquach@gfim.onmicrosoft.us `
  --scope /subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754/resourceGroups/rg-SCAI-Demo/providers/Microsoft.ContainerRegistry/registries/scaicr `
  --query "[].{role:roleDefinitionName, scope:scope}" -o table

# 6. Quick test — try creating a role assignment manually
Write-Host "`n=== Test: Create a Reader role assignment ===" -ForegroundColor Cyan
az role assignment create `
  --assignee khoaquach@gfim.onmicrosoft.us `
  --role "Reader" `
  --scope /subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754/resourceGroups/rg-SCAI-Demo

# 7. Check for deny assignments blocking role creation
Write-Host "`n=== Deny Assignments ===" -ForegroundColor Cyan
az rest --method GET `
  --url "/subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754/resourceGroups/rg-SCAI-Demo/providers/Microsoft.Authorization/denyAssignments?api-version=2022-04-01" `
  --query "value[].{name:denyAssignmentName, notActions:permissions[].notActions}" -o json

# 8. Check subscription-level roles (in case Owner was assigned there)
Write-Host "`n=== Subscription-level Roles ===" -ForegroundColor Cyan
az role assignment list `
  --assignee khoaquach@gfim.onmicrosoft.us `
  --scope /subscriptions/ea1fd5fa-bafe-43f8-a85f-939d5ee26754 `
  --query "[].{role:roleDefinitionName, scope:scope}" -o table
