# Azure Security Testing Reference

Security inspection guide based on the Azure Security Benchmark.
Verify compliance with the CIS Microsoft Azure Foundations Benchmark through automated inspection using az CLI commands.

## Azure AD / Entra ID Inspection

### Conditional Access and MFA

```bash
# List Conditional Access policies
az ad conditionalaccess policy list \
  --query '[].{name:displayName, state:state, grantControls:grantControls}' 2>/dev/null

# Verify policies that require MFA
az ad conditionalaccess policy list \
  --query '[?grantControls.builtInControls[?contains(@, `mfa`)]].displayName' 2>/dev/null

# Verify MFA status for all users
az ad user list --query '[].{UPN:userPrincipalName, MFA:strongAuthenticationDetail}' 2>/dev/null
```

### Privileged Identity Management (PIM)

```bash
# Members with Global Administrator role (CIS 1.1)
az role assignment list --role "Owner" --all \
  --query '[].{principal:principalName, scope:scope}'

# Permanent privileged role assignments
az role assignment list --all \
  --query '[?roleDefinitionName==`Owner` || roleDefinitionName==`Contributor`].{principal:principalName, role:roleDefinitionName, scope:scope}'

# Verify custom roles
az role definition list --custom-role-only true \
  --query '[].{name:roleName, permissions:permissions[].actions}'
```

### Application Registrations

```bash
# List application registrations
az ad app list --all \
  --query '[].{appId:appId, displayName:displayName, signInAudience:signInAudience}'

# Expired or soon-to-expire client secrets
az ad app list --all --query '[].{appId:appId, name:displayName, credentials:passwordCredentials[].{endDate:endDateTime}}' 2>/dev/null

# Multi-tenant applications (signInAudience is AzureADMultipleOrgs)
az ad app list --all \
  --query '[?signInAudience==`AzureADMultipleOrgs`].{appId:appId, name:displayName}'

# Apps with excessive API permissions
az ad app list --all \
  --query '[].{appId:appId, name:displayName, requiredResourceAccess:requiredResourceAccess}'
```

## Storage Inspection

### Storage Accounts

```bash
# List storage accounts
az storage account list \
  --query '[].{name:name, sku:sku.name, httpsOnly:enableHttpsTrafficOnly, minTls:minimumTlsVersion}'

# Verify HTTPS enforcement (CIS 3.1)
az storage account list \
  --query '[?enableHttpsTrafficOnly==`false`].name'

# Verify TLS version (CIS 3.15 - TLS 1.2 or above)
az storage account list \
  --query '[?minimumTlsVersion!=`TLS1_2`].{name:name, tls:minimumTlsVersion}'

# Verify blob public access (CIS 3.5)
az storage account list \
  --query '[?allowBlobPublicAccess==`true`].name'

# Storage account network rules
for account in $(az storage account list --query '[].name' -o tsv); do
  echo "=== $account ==="
  az storage account show --name "$account" \
    --query 'networkRuleSet.{defaultAction:defaultAction, ipRules:ipRules, virtualNetworkRules:virtualNetworkRules}'
done

# Storage account encryption settings
az storage account list \
  --query '[].{name:name, encryption:encryption.services}'
```

### SAS Tokens and Access Keys

```bash
# List storage account keys (rotation verification)
for account in $(az storage account list --query '[].name' -o tsv); do
  echo "=== $account ==="
  az storage account keys list --account-name "$account" \
    --query '[].{keyName:keyName, creationTime:creationTime}'
done

# Verify Shared Key access is disabled (recommended)
az storage account list \
  --query '[?allowSharedKeyAccess!=`false`].name'
```

## NSG (Network Security Group) Inspection

```bash
# List NSGs
az network nsg list \
  --query '[].{name:name, rg:resourceGroup, rules:securityRules[].{name:name, access:access, direction:direction, sourceAddr:sourceAddressPrefix, destPort:destinationPortRange, priority:priority}}'

# NSG rules allowing all ports
az network nsg list --query '[].securityRules[?sourceAddressPrefix==`*` && access==`Allow` && direction==`Inbound`].{nsg:id, name:name, destPort:destinationPortRange, priority:priority}' -o table

# NSG rules with SSH (22) open to all (CIS 6.1)
az network nsg list \
  --query '[].securityRules[?sourceAddressPrefix==`*` && destinationPortRange==`22` && access==`Allow` && direction==`Inbound`].{name:name, priority:priority}'

# NSG rules with RDP (3389) open to all (CIS 6.2)
az network nsg list \
  --query '[].securityRules[?sourceAddressPrefix==`*` && destinationPortRange==`3389` && access==`Allow` && direction==`Inbound`].{name:name, priority:priority}'

# Verify NSG Flow Logs (CIS 6.4)
az network watcher flow-log list \
  --query '[].{name:name, enabled:enabled, nsg:targetResourceId, retention:retentionPolicy}' 2>/dev/null
```

## Key Vault Inspection

```bash
# List Key Vaults
az keyvault list \
  --query '[].{name:name, sku:properties.sku.name, softDelete:properties.enableSoftDelete, purgeProtection:properties.enablePurgeProtection}'

# Key Vaults without soft delete enabled (CIS 8.4)
az keyvault list \
  --query '[?properties.enableSoftDelete!=`true`].name'

# Key Vaults without purge protection enabled (CIS 8.5)
az keyvault list \
  --query '[?properties.enablePurgeProtection!=`true`].name'

# Verify Key Vault access policies
for vault in $(az keyvault list --query '[].name' -o tsv); do
  echo "=== $vault ==="
  az keyvault show --name "$vault" \
    --query 'properties.accessPolicies[].{objectId:objectId, permissions:permissions}'
done

# Key Vault network rules
for vault in $(az keyvault list --query '[].name' -o tsv); do
  az keyvault show --name "$vault" \
    --query 'properties.networkAcls.{defaultAction:defaultAction, ipRules:ipRules}'
done

# Key rotation status
for vault in $(az keyvault list --query '[].name' -o tsv); do
  echo "=== $vault ==="
  az keyvault key list --vault-name "$vault" \
    --query '[].{name:name, enabled:attributes.enabled, expires:attributes.expires, created:attributes.created}' 2>/dev/null
done
```

## App Service Inspection

```bash
# List App Services
az webapp list \
  --query '[].{name:name, rg:resourceGroup, httpsOnly:httpsOnly, state:state}'

# Verify HTTPS enforcement (CIS 9.2)
az webapp list \
  --query '[?httpsOnly==`false`].name'

# Verify managed identities
az webapp list \
  --query '[].{name:name, identity:identity.type}'

# Verify authentication settings (CIS 9.1)
for app in $(az webapp list --query '[].name' -o tsv); do
  rg=$(az webapp show --name "$app" --query 'resourceGroup' -o tsv)
  az webapp auth show --name "$app" --resource-group "$rg" \
    --query '{enabled:enabled, defaultProvider:defaultProvider}' 2>/dev/null
done

# Verify TLS version (CIS 9.3)
for app in $(az webapp list --query '[].name' -o tsv); do
  rg=$(az webapp show --name "$app" --query 'resourceGroup' -o tsv)
  az webapp config show --name "$app" --resource-group "$rg" \
    --query '{minTlsVersion:minTlsVersion, ftpsState:ftpsState, http20Enabled:http20Enabled}'
done

# Verify client certificates
az webapp list \
  --query '[].{name:name, clientCertEnabled:clientCertEnabled}'
```

## SQL Database Inspection

```bash
# List SQL Servers
az sql server list \
  --query '[].{name:name, rg:resourceGroup, adminLogin:administratorLogin, minTls:minimalTlsVersion}'

# Verify firewall rules (CIS 4.1.1)
for server in $(az sql server list --query '[].name' -o tsv); do
  rg=$(az sql server show --name "$server" --query 'resourceGroup' -o tsv)
  echo "=== $server ==="
  az sql server firewall-rule list --server "$server" --resource-group "$rg" \
    --query '[].{name:name, startIp:startIpAddress, endIp:endIpAddress}'
done

# Detect 0.0.0.0 - 255.255.255.255 rules
for server in $(az sql server list --query '[].name' -o tsv); do
  rg=$(az sql server show --name "$server" --query 'resourceGroup' -o tsv)
  az sql server firewall-rule list --server "$server" --resource-group "$rg" \
    --query '[?startIpAddress==`0.0.0.0` && endIpAddress==`255.255.255.255`].name'
done

# Verify TDE (Transparent Data Encryption) (CIS 4.1.2)
for server in $(az sql server list --query '[].name' -o tsv); do
  rg=$(az sql server show --name "$server" --query 'resourceGroup' -o tsv)
  for db in $(az sql db list --server "$server" --resource-group "$rg" --query '[].name' -o tsv); do
    az sql db tde show --server "$server" --database "$db" --resource-group "$rg" \
      --query '{database:databaseName, status:status}' 2>/dev/null
  done
done

# Verify audit settings (CIS 4.1.3)
for server in $(az sql server list --query '[].name' -o tsv); do
  rg=$(az sql server show --name "$server" --query 'resourceGroup' -o tsv)
  az sql server audit-policy show --server "$server" --resource-group "$rg" \
    --query '{state:state, retentionDays:retentionDays}' 2>/dev/null
done

# Verify AAD administrator (CIS 4.1.4)
for server in $(az sql server list --query '[].name' -o tsv); do
  rg=$(az sql server show --name "$server" --query 'resourceGroup' -o tsv)
  az sql server ad-admin list --server "$server" --resource-group "$rg" 2>/dev/null
done
```

## AKS Inspection

```bash
# List AKS clusters
az aks list \
  --query '[].{name:name, rg:resourceGroup, rbac:enableRbac, networkPolicy:networkProfile.networkPolicy}'

# Clusters without RBAC enabled (CIS 8.5)
az aks list \
  --query '[?enableRbac==`false`].name'

# Verify Azure AD integration
az aks list \
  --query '[].{name:name, aadProfile:aadProfile}'

# Verify network policies
az aks list \
  --query '[?networkProfile.networkPolicy==`null`].name'

# API server authorized IP ranges
az aks list \
  --query '[].{name:name, authorizedIpRanges:apiServerAccessProfile.authorizedIpRanges}'

# Verify pod security
az aks list \
  --query '[].{name:name, podSecurityPolicy:podSecurityPolicy}'
```

## Functions Inspection

```bash
# List Function Apps
az functionapp list \
  --query '[].{name:name, rg:resourceGroup, httpsOnly:httpsOnly, identity:identity.type}'

# Verify authentication settings
for app in $(az functionapp list --query '[].name' -o tsv); do
  rg=$(az functionapp show --name "$app" --query 'resourceGroup' -o tsv)
  az functionapp auth show --name "$app" --resource-group "$rg" \
    --query '{enabled:enabled}' 2>/dev/null
done

# Verify HTTPS enforcement
az functionapp list \
  --query '[?httpsOnly==`false`].name'

# Verify managed identity usage
az functionapp list \
  --query '[?identity.type==`null`].name'
```

## Monitor and Diagnostic Settings Inspection

```bash
# Subscription-level Activity Log alerts (CIS 5.2.x)
az monitor activity-log alert list \
  --query '[].{name:name, enabled:enabled, scopes:scopes, condition:condition}'

# Verify resource Diagnostic Settings
az monitor diagnostic-settings list --resource <RESOURCE_ID> \
  --query '[].{name:name, logs:logs[].{category:category, enabled:enabled}, metrics:metrics[].{category:category, enabled:enabled}}' 2>/dev/null

# List Log Analytics Workspaces
az monitor log-analytics workspace list \
  --query '[].{name:name, rg:resourceGroup, retention:retentionInDays, sku:sku.name}'

# Verify retention period (CIS 5.1.2 - 90+ days recommended)
az monitor log-analytics workspace list \
  --query '[?retentionInDays < `90`].{name:name, retention:retentionInDays}'
```

## Defender for Cloud Inspection

```bash
# Verify Secure Score
az security secure-score list \
  --query '[].{name:displayName, current:score.current, max:score.max, percentage:score.percentage}'

# Security recommendations (High and above)
az security assessment list \
  --query '[?status.code==`Unhealthy` && (properties.metadata.severity==`High` || properties.metadata.severity==`Critical`)].{name:displayName, severity:properties.metadata.severity, status:status.code}' 2>/dev/null

# Verify Defender plan enablement status
az security pricing list \
  --query '[].{name:name, tier:pricingTier}'

# Verify each plan is Standard (enabled)
az security pricing list \
  --query '[?pricingTier==`Free`].name'
```

## Private Endpoints Inspection

```bash
# List Private Endpoints
az network private-endpoint list \
  --query '[].{name:name, rg:resourceGroup, subnet:subnet.id, connections:privateLinkServiceConnections[].{service:privateLinkServiceId, status:privateLinkServiceConnectionState.status}}'

# Verify resources without Private Link configured (storage)
for account in $(az storage account list --query '[].name' -o tsv); do
  pe=$(az storage account show --name "$account" --query 'privateEndpointConnections' -o tsv)
  [ -z "$pe" ] && echo "NO PRIVATE ENDPOINT: $account"
done

# Verify Private DNS Zones
az network private-dns zone list \
  --query '[].{name:name, numberOfRecordSets:numberOfRecordSets}'
```

## Codebase Static Analysis

```bash
# Detect hardcoded Azure credentials
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java,cs}' \
  -iE '(azure_client_secret|azure_tenant_id|DefaultEndpointsProtocol)' . | grep -v node_modules

# Hardcoded SAS tokens
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java,cs}' \
  -E '(sv=|sig=|se=|sp=).*(&sv=|&sig=|&se=|&sp=)' . | grep -v node_modules

# Hardcoded connection strings
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java,cs}' \
  -E '(AccountKey=|SharedAccessKey=|Password=)[A-Za-z0-9+/=]{10,}' . | grep -v node_modules

# Azure credentials in .env files
grep -rn -iE '(AZURE_CLIENT_SECRET|AZURE_STORAGE_KEY|AZURE_SQL_PASSWORD)' .env* 2>/dev/null
```

## Common Misconfigurations

| Severity | Misconfiguration | CIS | Impact |
|----------|------------------|-----|--------|
| Critical | NSG allowing all ports from * | 6.1 | All services exposed to the internet |
| Critical | SQL Server firewall allowing all IPs | 4.1.1 | Direct database access |
| Critical | Public blob access on Storage Account | 3.5 | Full data exposure |
| Critical | Hardcoded credentials | - | Credential leakage |
| High | Soft delete not enabled on Key Vault | 8.4 | Risk of permanent secret deletion |
| High | HTTPS not enforced on App Service | 9.2 | Traffic interception |
| High | TDE not enabled on SQL Database | 4.1.2 | Stored data exposed in plaintext |
| High | Defender for Cloud on Free plan | - | Lack of threat detection |
| High | MFA not configured in Conditional Access | 1.1 | Account takeover risk |
| Medium | NSG Flow Logs not enabled | 6.4 | Unable to monitor network |
| Medium | RBAC not enabled on AKS | - | Lack of Kubernetes access control |
| Medium | Insufficient Log Analytics retention period | 5.1.2 | Loss of audit trail |
| Medium | Managed identity not used | - | Complex credential management |
| Low | TLS 1.2 not enforced on Storage Account | 3.15 | Use of legacy protocols |
| Low | Private Endpoint not configured | - | Access via public network |

## Security Checklist

### Azure AD / Entra ID (CIS 1.x)
- [ ] MFA is required via Conditional Access policies
- [ ] Global administrators are restricted to minimal members
- [ ] Privileged roles are Just-In-Time enabled via PIM
- [ ] Application registration secrets are within validity period
- [ ] Multi-tenant apps are kept to a minimum

### Storage (CIS 3.x)
- [ ] HTTPS transfer is enforced
- [ ] Minimum TLS version is 1.2 or above
- [ ] Blob public access is disabled
- [ ] Network rules default action is Deny
- [ ] Shared Key access is disabled

### Network (CIS 6.x)
- [ ] SSH (22) is restricted to specific IPs in NSGs
- [ ] RDP (3389) is restricted to specific IPs in NSGs
- [ ] NSG Flow Logs are enabled
- [ ] Private Endpoints are properly configured

### Key Vault (CIS 8.x)
- [ ] Soft delete is enabled
- [ ] Purge protection is enabled
- [ ] Access policies follow least privilege
- [ ] Network rules are configured
- [ ] Key rotation is configured

### App Service (CIS 9.x)
- [ ] HTTPS is enforced
- [ ] Managed identity is used
- [ ] Authentication is enabled
- [ ] Minimum TLS version is 1.2 or above
- [ ] FTPS is disabled

### SQL Database (CIS 4.1.x)
- [ ] No firewall rules allowing all IPs
- [ ] TDE is enabled
- [ ] Auditing is enabled
- [ ] AAD administrator is configured
- [ ] Minimum TLS version is 1.2 or above

### Monitoring (CIS 5.x)
- [ ] Activity Log alerts are configured
- [ ] Diagnostic Settings are properly configured
- [ ] Log Analytics retention period is 90+ days
- [ ] Defender for Cloud is on Standard plan

### Containers
- [ ] RBAC is enabled on AKS
- [ ] Azure AD integration is configured
- [ ] Network policies are configured
- [ ] API server authorized IP ranges are restricted
