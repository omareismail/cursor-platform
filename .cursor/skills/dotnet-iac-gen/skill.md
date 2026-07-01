# Skill: dotnet-iac-gen

**Invocation:** `/dotnet-iac-gen [resource-description]`

---

## Overview

**Memory references:** `memory-bank/deploymentNotes.md, memory-bank/technologyStack.md`

`dotnet-iac-gen` generates parameterized Infrastructure-as-Code templates for
Azure resources that a feature requires. It defaults to Bicep unless Terraform
is already established in `memory-bank/techContext.md`. If both are viable and
no choice has been made, it invokes `/speckit-options` before generating anything.
All templates are parameterized — no hardcoded environment names, subscription IDs,
or connection strings. Resources that require manual approval (Key Vault access
policies in production, SQL server firewall rules, RBAC assignments) are flagged
explicitly so they are not applied automatically in a CI/CD pipeline.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing IaC module.**

Run `/pattern-finder new IaC resource for [resource-description]`. Imitate
the matched module's parameterization style and naming convention for
environment/resource names — Step 1 decides Bicep vs. Terraform, this
decides how this repo writes Bicep/Terraform once that choice is made.

**Step 1 — Detect IaC tool preference.**

Read `memory-bank/techContext.md`:
- Bicep files present → Bicep
- Terraform files present → Terraform (HCL)
- Neither → run `/speckit-options` (Bicep / Terraform / ARM templates)

**Step 2 — Read resource requirements from the spec.**

Check:
- `## Database Changes` → SQL Server/PostgreSQL resource
- `## Integration Events` → Service Bus namespace + topic + subscription
- `## New Environment Variables` → Key Vault secrets
- Hosting: App Service / Container Apps / AKS

**Step 3 — Generate parameterized Bicep template.**

```bicep
// infra/modules/[resource-name].bicep
@description('Environment name (dev | staging | prod)')
param environmentName string

@description('Location for all resources')
param location string = resourceGroup().location

@description('Application name prefix')
param appName string

var resourcePrefix = '${appName}-${environmentName}'

// SQL Database
resource sqlServer 'Microsoft.Sql/servers@2023-05-01-preview' = {
  name: '${resourcePrefix}-sql'
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword // injected from Key Vault
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled' // VNet-only access
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-05-01-preview' = {
  parent: sqlServer
  name: '${appName}-db'
  location: location
  sku: {
    name: environmentName == 'prod' ? 'S2' : 'Basic'
    tier: environmentName == 'prod' ? 'Standard' : 'Basic'
  }
}
```

**Step 4 — Flag manual approval resources.**

For each of the following, output a `⚠ MANUAL APPROVAL REQUIRED` notice:
- Key Vault access policy grants
- SQL Server firewall rules
- RBAC role assignments on production resources
- Service principal creation

```
⚠ MANUAL APPROVAL REQUIRED: Key Vault access policy
  Resource: kv-orientportal-prod
  Action: grant 'get, list' secrets access to app service managed identity
  Risk: Production Key Vault — must be approved by security team before apply
  Azure CLI command (run manually):
    az keyvault set-policy --name kv-orientportal-prod \
      --object-id [app-service-managed-identity-id] \
      --secret-permissions get list
```

**Step 5 — Generate deployment command.**

```bash
# Bicep deployment
az deployment group create \
  --resource-group rg-orientportal-dev \
  --template-file infra/modules/[resource-name].bicep \
  --parameters environmentName=dev appName=orientportal

# Terraform
terraform init && terraform plan -var="environment=dev" -var="app_name=orientportal"
```

---

## Example Invocation

**Command:** `/dotnet-iac-gen service-bus-topic-for-broker-events`

Agent reads spec `## Integration Events` — new topic `broker-events`, subscription
`audit-service`. Generates `infra/modules/service-bus.bicep` with parameterized
namespace, topic, and subscription. Flags RBAC assignment as manual approval.

---

## Output

- New: `infra/modules/[resource-name].bicep` (or `.tf`)
- New: `infra/[resource-name].parameters.dev.json` + `.prod.json`
- Terminal: deployment command + list of manual-approval items
