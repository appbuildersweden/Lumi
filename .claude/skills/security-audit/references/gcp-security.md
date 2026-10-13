# GCP Security Testing Reference

Security inspection guide based on GCP Security Best Practices.
Verify compliance with the CIS GCP Foundations Benchmark through automated inspection using gcloud CLI commands.

## IAM Inspection

### Service Accounts

```bash
# List service accounts in the project
gcloud iam service-accounts list --format='table(email, displayName, disabled)'

# User-managed service account keys (CIS 1.4)
for sa in $(gcloud iam service-accounts list --format='value(email)'); do
  keys=$(gcloud iam service-accounts keys list --iam-account "$sa" \
    --managed-by user --format='value(name)')
  [ -n "$keys" ] && echo "USER MANAGED KEY: $sa"
done

# Keys not rotated for 90+ days
for sa in $(gcloud iam service-accounts list --format='value(email)'); do
  gcloud iam service-accounts keys list --iam-account "$sa" \
    --managed-by user --format='table(name, validAfterTime, validBeforeTime)' 2>/dev/null
done

# Verify use of default service accounts (CIS 1.5)
gcloud iam service-accounts list --format='value(email)' | grep -E 'compute@developer|appspot'
```

### IAM Policies and Roles

```bash
# Verify project-level IAM bindings
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --format='table(bindings.role, bindings.members)'

# Overly broad permissions (Editor/Owner roles - CIS 1.6)
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --flatten='bindings[].members' \
  --filter='bindings.role:(roles/editor OR roles/owner)' \
  --format='table(bindings.role, bindings.members)'

# allUsers / allAuthenticatedUsers bindings (CIS 1.12)
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --flatten='bindings[].members' \
  --filter='bindings.members:(allUsers OR allAuthenticatedUsers)' \
  --format='table(bindings.role, bindings.members)'

# Verify custom roles
gcloud iam roles list --project=$(gcloud config get-value project) \
  --format='table(name, title, stage)'

# Verify Workload Identity
gcloud iam service-accounts get-iam-policy <SERVICE_ACCOUNT_EMAIL> \
  --format='table(bindings.role, bindings.members)' 2>/dev/null
```

### Organization Policies

```bash
# List organization policies
gcloud resource-manager org-policies list --project=$(gcloud config get-value project) \
  --format='table(constraint, listPolicy, booleanPolicy)' 2>/dev/null

# Verify domain restriction policy (CIS 1.1)
gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains \
  --project=$(gcloud config get-value project) 2>/dev/null
```

## GCS Inspection

### Bucket Access

```bash
# List all buckets
gsutil ls -p $(gcloud config get-value project)

# Verify bucket IAM policies
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  echo "=== $bucket ==="
  gsutil iam get "$bucket" 2>/dev/null | grep -E '(allUsers|allAuthenticatedUsers)'
done

# Detect public buckets (CIS 5.1)
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  gsutil iam get "$bucket" 2>/dev/null | grep -q 'allUsers' && echo "PUBLIC: $bucket"
done

# Verify uniform bucket-level access (CIS 5.2)
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  gsutil uniformbucketlevelaccess get "$bucket" 2>/dev/null
done
```

### Bucket Encryption and Logging

```bash
# Bucket encryption settings (CMEK verification)
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  gsutil kms get "$bucket" 2>/dev/null || echo "DEFAULT ENCRYPTION: $bucket"
done

# Bucket access logs
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  gsutil logging get "$bucket" 2>/dev/null
done

# Bucket versioning
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  gsutil versioning get "$bucket" 2>/dev/null
done

# Bucket retention policy
for bucket in $(gsutil ls -p $(gcloud config get-value project)); do
  gsutil retention get "$bucket" 2>/dev/null
done
```

## VPC Inspection

### Firewall Rules

```bash
# List all firewall rules
gcloud compute firewall-rules list \
  --format='table(name, network, direction, priority, allowed, sourceRanges, targetTags)'

# Ingress allow rules from 0.0.0.0/0 (CIS 3.6/3.7)
gcloud compute firewall-rules list \
  --filter='sourceRanges=0.0.0.0/0 AND direction=INGRESS' \
  --format='table(name, allowed, targetTags, priority)'

# Rules with SSH (22) open to all (CIS 3.6)
gcloud compute firewall-rules list \
  --filter='sourceRanges=0.0.0.0/0 AND direction=INGRESS AND allowed[].ports=22' \
  --format='table(name, network, targetTags)'

# Rules with RDP (3389) open to all (CIS 3.7)
gcloud compute firewall-rules list \
  --filter='sourceRanges=0.0.0.0/0 AND direction=INGRESS AND allowed[].ports=3389' \
  --format='table(name, network, targetTags)'

# Verify existence of default network (CIS 3.1 - deletion recommended)
gcloud compute networks list --filter='name=default' --format='table(name, autoCreateSubnetworks)'
```

### VPC Service Controls and Private Access

```bash
# Verify Private Google Access (CIS 3.8)
gcloud compute networks subnets list \
  --format='table(name, region, privateIpGoogleAccess)'

# Verify VPC Service Controls perimeters
gcloud access-context-manager perimeters list --format='table(name, title, status)' 2>/dev/null
```

## Compute Inspection

```bash
# Verify OS Login is enabled (CIS 4.4)
gcloud compute project-info describe \
  --format='value(commonInstanceMetadata.items[key=enable-oslogin].value)'

# Verify serial port is disabled (CIS 4.5)
gcloud compute instances list \
  --format='table(name, zone, metadata.items[key=serial-port-enable].value)'

# Verify service account scopes (CIS 4.2)
gcloud compute instances list \
  --format='table(name, serviceAccounts[].email, serviceAccounts[].scopes)'

# Instances using default service account
gcloud compute instances list \
  --format='value(name, serviceAccounts[].email)' | grep 'compute@developer'

# Verify Shielded VM (CIS 4.8)
gcloud compute instances list \
  --format='table(name, shieldedInstanceConfig.enableSecureBoot, shieldedInstanceConfig.enableVtpm, shieldedInstanceConfig.enableIntegrityMonitoring)'

# Instances with public IPs
gcloud compute instances list \
  --format='table(name, zone, networkInterfaces[].accessConfigs[].natIP)' | grep -v 'None'

# Verify disk encryption
gcloud compute disks list \
  --format='table(name, zone, diskEncryptionKey)'
```

## Cloud SQL Inspection

```bash
# List Cloud SQL instances
gcloud sql instances list --format='table(name, databaseVersion, settings.tier, settings.ipConfiguration.ipv4Enabled)'

# Cloud SQL with public IP enabled (CIS 6.5)
gcloud sql instances list \
  --filter='settings.ipConfiguration.ipv4Enabled=true' \
  --format='table(name, databaseVersion)'

# Cloud SQL without SSL enforced (CIS 6.4)
gcloud sql instances list --format='json' | \
  jq '.[] | select(.settings.ipConfiguration.requireSsl != true) | .name'

# Verify authorized networks (detect 0.0.0.0/0)
for instance in $(gcloud sql instances list --format='value(name)'); do
  gcloud sql instances describe "$instance" \
    --format='value(settings.ipConfiguration.authorizedNetworks[].value)' | \
    grep '0\.0\.0\.0' && echo "OPEN NETWORK: $instance"
done

# Verify automated backups (CIS 6.7)
gcloud sql instances list \
  --format='table(name, settings.backupConfiguration.enabled, settings.backupConfiguration.pointInTimeRecoveryEnabled)'
```

## Cloud Functions Inspection

```bash
# List Cloud Functions
gcloud functions list --format='table(name, runtime, serviceAccountEmail, ingressSettings)'

# Cloud Functions open to all (ingress is all-traffic)
gcloud functions list \
  --filter='ingressSettings=ALLOW_ALL' \
  --format='table(name, ingressSettings)'

# Verify service accounts
gcloud functions list \
  --format='table(name, serviceAccountEmail)' | grep 'appspot.gserviceaccount.com'

# Functions without VPC connector
gcloud functions list \
  --format='table(name, vpcConnector)' | grep -E '\s*$'

# Secrets in environment variables
for fn in $(gcloud functions list --format='value(name)'); do
  gcloud functions describe "$fn" --format='json' | \
    jq '.environmentVariables // {} | to_entries[] | select(.key | test("SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL"; "i"))' 2>/dev/null && echo "  -> $fn"
done
```

## KMS Inspection

```bash
# List KMS key rings
gcloud kms keyrings list --location=global --format='table(name)'

# Verify key rotation period (CIS 1.10)
for keyring in $(gcloud kms keyrings list --location=global --format='value(name)'); do
  for key in $(gcloud kms keys list --keyring="$keyring" --location=global --format='value(name)'); do
    gcloud kms keys describe "$key" --keyring="$keyring" --location=global \
      --format='table(name, rotationPeriod, nextRotationTime)' 2>/dev/null
  done
done

# Verify KMS key IAM policies
for keyring in $(gcloud kms keyrings list --location=global --format='value(name)'); do
  for key in $(gcloud kms keys list --keyring="$keyring" --location=global --format='value(name)'); do
    gcloud kms keys get-iam-policy "$key" --keyring="$keyring" --location=global \
      --format='table(bindings.role, bindings.members)' 2>/dev/null
  done
done
```

## Cloud Audit Logs Inspection

```bash
# Verify audit log configuration (CIS 2.1)
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --format='json' | jq '.auditConfigs'

# Verify data access logs are enabled
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --format='json' | jq '.auditConfigs[] | select(.auditLogConfigs[].logType == "DATA_READ" or .auditLogConfigs[].logType == "DATA_WRITE")'

# Verify log sinks (export destinations)
gcloud logging sinks list --format='table(name, destination, filter)'

# Log-based metrics and alerts
gcloud logging metrics list --format='table(name, filter)'
```

## Security Command Center Inspection

```bash
# Security Command Center findings
gcloud scc findings list $(gcloud config get-value project) \
  --filter='state="ACTIVE" AND severity="HIGH" OR severity="CRITICAL"' \
  --format='table(finding.category, finding.severity, finding.resourceName)' 2>/dev/null

# Verify compliance status
gcloud scc sources list --organization=$(gcloud organizations list --format='value(name)' | head -1) 2>/dev/null
```

## Cloud Armor Inspection

```bash
# List security policies
gcloud compute security-policies list --format='table(name, type)'

# Verify policy rules
for policy in $(gcloud compute security-policies list --format='value(name)'); do
  echo "=== $policy ==="
  gcloud compute security-policies rules list "$policy" \
    --format='table(priority, action, match.config.srcIpRanges, description)'
done

# Verify WAF rules
for policy in $(gcloud compute security-policies list --format='value(name)'); do
  gcloud compute security-policies describe "$policy" \
    --format='json' | jq '.rules[] | select(.match.expr != null) | {priority, action, expression: .match.expr.expression}'
done

# DDoS protection (Adaptive Protection)
gcloud compute security-policies list --format='json' | \
  jq '.[] | {name, adaptiveProtectionConfig}'
```

## Secret Manager Inspection

```bash
# List secrets
gcloud secrets list --format='table(name, replication.automatic, createTime)'

# Verify secret IAM bindings
for secret in $(gcloud secrets list --format='value(name)'); do
  echo "=== $secret ==="
  gcloud secrets get-iam-policy "$secret" \
    --format='table(bindings.role, bindings.members)' 2>/dev/null
done

# Verify rotation configuration
for secret in $(gcloud secrets list --format='value(name)'); do
  gcloud secrets describe "$secret" \
    --format='json' | jq '{name: .name, rotation: .rotation}' 2>/dev/null
done
```

## Codebase Static Analysis

```bash
# Detect GCP service account key files
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java}' \
  -E '(private_key_id|client_email.*gserviceaccount)' . | grep -v node_modules

# Hardcoded GCP API keys
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java}' \
  -E 'AIza[0-9A-Za-z_-]{35}' . | grep -v node_modules

# Service account JSON key files
find . -name '*.json' -exec grep -l 'private_key_id' {} \; 2>/dev/null | grep -v node_modules
```

## Common Misconfigurations

| Severity | Misconfiguration | CIS | Impact |
|----------|------------------|-----|--------|
| Critical | Public IAM binding to allUsers | 1.12 | Resource access granted to all users |
| Critical | GCS bucket publicly exposed | 5.1 | Full data exposure |
| Critical | 0.0.0.0/0 authorized network on Cloud SQL | 6.5 | Direct database access |
| Critical | Service account keys in source code | 1.4 | Credential leakage |
| High | Excessive Editor/Owner role grants | 1.6 | Overly broad permissions |
| High | SSH open to all in firewall | 3.6 | Unauthorized access risk |
| High | SSL not enforced on Cloud SQL | 6.4 | Traffic interception |
| High | Default network still exists | 3.1 | Unintended network exposure |
| Medium | OS Login not enabled | 4.4 | Decentralized SSH key management |
| Medium | KMS key rotation not configured | 1.10 | Prolonged use of the same key |
| Medium | Cloud Audit Logs data access logging not configured | 2.1 | Insufficient audit trail |
| Medium | Shielded VM not enabled | 4.8 | Boot integrity not verified |
| Low | Uniform bucket-level access not used | 5.2 | ACL management complexity |
| Low | Private Google Access not configured | 3.8 | Traffic routed via public IPs |

## Security Checklist

### IAM (CIS 1.x)
- [ ] No allUsers / allAuthenticatedUsers bindings exist
- [ ] Editor/Owner roles are restricted to minimal members
- [ ] Service account keys are rotated regularly
- [ ] Default service accounts are not in use
- [ ] Workload Identity is used where possible
- [ ] Domain restriction is set in organization policies

### GCS (CIS 5.x)
- [ ] No public buckets exist
- [ ] Uniform bucket-level access is enabled
- [ ] CMEK or default encryption is configured
- [ ] Bucket access logging is enabled
- [ ] Versioning is enabled

### Network (CIS 3.x)
- [ ] Default network is deleted
- [ ] SSH (22) is restricted to specific IPs
- [ ] RDP (3389) is restricted to specific IPs
- [ ] Private Google Access is enabled
- [ ] VPC Service Controls are configured

### Compute (CIS 4.x)
- [ ] OS Login is enabled
- [ ] Shielded VM is enabled
- [ ] No instances using default service accounts
- [ ] Serial port is disabled
- [ ] Public IPs are minimized

### Database (CIS 6.x)
- [ ] Cloud SQL does not have public IP configured
- [ ] SSL is enforced
- [ ] No 0.0.0.0/0 in authorized networks
- [ ] Automated backups are enabled
- [ ] Point-in-Time Recovery is enabled

### Logging and Monitoring (CIS 2.x)
- [ ] Cloud Audit Logs data access logging is enabled
- [ ] Log sinks are properly configured
- [ ] Log-based alerts are configured
- [ ] Security Command Center is enabled

### Secret Management
- [ ] Secret Manager is in use
- [ ] Secret rotation is configured
- [ ] Service account keys are not included in source code
- [ ] API keys are not hardcoded
