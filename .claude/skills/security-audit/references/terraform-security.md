# Terraform Security Testing Reference

Security inspection guide at the Infrastructure as Code configuration level for Terraform.
Detect misconfigurations in major resources across AWS/GCP/Azure through static analysis.

## State File Security

### Remote State Encryption Verification

```bash
# Check if encryption is enabled in backend configuration
grep -rn --include='*.tf' -E 'backend\s+"s3"' . | head -20
grep -rn --include='*.tf' -A 10 'backend\s+"s3"' . | grep -i 'encrypt'

# Check if state files remain locally
find . -name 'terraform.tfstate' -o -name 'terraform.tfstate.backup' 2>/dev/null

# Check if state files are included in .gitignore
grep -n 'tfstate' .gitignore 2>/dev/null
```

### Secret Detection in State Files

```bash
# Passwords and tokens in state files
grep -iE '(password|secret|token|api_key|private_key)' terraform.tfstate 2>/dev/null | head -20

# Hardcoded sensitive information in tfvars files
grep -rn --include='*.tfvars' -iE '(password|secret|token|api_key|private_key)\s*=' .
```

## Provider Configuration Inspection

```bash
# Detection of hardcoded credentials
grep -rn --include='*.tf' -E '(access_key|secret_key|api_key|token)\s*=' .

# Verify use of assume_role (recommended)
grep -rn --include='*.tf' -A 5 'assume_role' .

# Verify provider version pinning
grep -rn --include='*.tf' -E 'required_providers' -A 20 . | grep -E '(version|source)'
```

## AWS Resource Inspection

### S3 Bucket Policy

```bash
# Verify public access block settings
grep -rn --include='*.tf' -B 2 -A 10 'aws_s3_bucket_public_access_block' .

# Bucket encryption settings
grep -rn --include='*.tf' -B 2 -A 10 'aws_s3_bucket_server_side_encryption' .

# Bucket versioning
grep -rn --include='*.tf' -B 2 -A 5 'aws_s3_bucket_versioning' .

# Bucket logging
grep -rn --include='*.tf' -B 2 -A 5 'aws_s3_bucket_logging' .

# Detection of public ACLs
grep -rn --include='*.tf' -E 'acl\s*=\s*"public' .
```

### IAM Roles and Policies

```bash
# Detection of wildcard actions ("*")
grep -rn --include='*.tf' -E '"Action"\s*:\s*"\*"' .
grep -rn --include='*.tf' -E 'actions\s*=\s*\["\*"\]' .

# Detection of wildcard resources
grep -rn --include='*.tf' -E '"Resource"\s*:\s*"\*"' .
grep -rn --include='*.tf' -E 'resources\s*=\s*\["\*"\]' .

# AssumeRole trust policy (overly broad principals)
grep -rn --include='*.tf' -E '"Principal"\s*:\s*"\*"' .
```

### Security Groups

```bash
# Detection of all ports open to 0.0.0.0/0
grep -rn --include='*.tf' -B 5 -A 5 '0\.0\.0\.0/0' . | grep -E '(ingress|cidr_blocks)'

# SSH port (22) open to all
grep -rn --include='*.tf' -B 10 'from_port\s*=\s*22' . | grep -E '(0\.0\.0\.0/0|cidr_blocks)'

# RDP port (3389) open to all
grep -rn --include='*.tf' -B 10 'from_port\s*=\s*3389' . | grep -E '(0\.0\.0\.0/0|cidr_blocks)'

# Verify egress allow-all
grep -rn --include='*.tf' -B 3 -A 10 'egress' . | grep '0\.0\.0\.0/0'
```

### KMS and Encryption

```bash
# Verify KMS key rotation
grep -rn --include='*.tf' -B 5 -A 10 'aws_kms_key' . | grep 'enable_key_rotation'

# EBS encryption default setting
grep -rn --include='*.tf' 'aws_ebs_encryption_by_default' .

# RDS encryption
grep -rn --include='*.tf' -B 5 -A 15 'aws_db_instance' . | grep 'storage_encrypted'
```

### RDS

```bash
# Publicly accessible RDS instances
grep -rn --include='*.tf' -B 5 -A 15 'aws_db_instance' . | grep 'publicly_accessible'

# Verify automated backups
grep -rn --include='*.tf' -B 5 -A 15 'aws_db_instance' . | grep 'backup_retention_period'

# Deletion protection
grep -rn --include='*.tf' -B 5 -A 15 'aws_db_instance' . | grep 'deletion_protection'

# Hardcoded master password
grep -rn --include='*.tf' -E 'password\s*=\s*"[^"$]' .
```

### Lambda

```bash
# Detection of overly permissive IAM roles ("*" actions)
grep -rn --include='*.tf' -B 5 -A 20 'aws_iam_role_policy.*lambda' .

# Secrets in environment variables
grep -rn --include='*.tf' -B 5 -A 20 'aws_lambda_function' . | grep -iE '(password|secret|token|key)'

# Verify VPC configuration
grep -rn --include='*.tf' -B 5 -A 20 'aws_lambda_function' . | grep 'vpc_config'
```

## GCP Resource Inspection

```bash
# Public IAM bindings (allUsers / allAuthenticatedUsers)
grep -rn --include='*.tf' -E '(allUsers|allAuthenticatedUsers)' .

# GCS bucket public access settings
grep -rn --include='*.tf' -B 5 -A 10 'google_storage_bucket_iam' . | grep -E '(allUsers|allAuthenticatedUsers)'

# Compute firewall open to all
grep -rn --include='*.tf' -B 5 -A 10 'google_compute_firewall' . | grep '0\.0\.0\.0/0'

# Cloud SQL public IP
grep -rn --include='*.tf' -B 5 -A 15 'google_sql_database_instance' . | grep -E '(ipv4_enabled|authorized_networks)'
```

## Azure Resource Inspection

```bash
# NSG rules allowing all ports
grep -rn --include='*.tf' -B 5 -A 10 'azurerm_network_security_rule' . | grep -E '(0\.0\.0\.0|\*)'

# Key Vault soft delete disabled
grep -rn --include='*.tf' -B 5 -A 15 'azurerm_key_vault' . | grep 'soft_delete'

# Storage Account HTTPS enforcement
grep -rn --include='*.tf' -B 5 -A 15 'azurerm_storage_account' . | grep 'enable_https_traffic_only'

# RBAC configuration
grep -rn --include='*.tf' -B 5 -A 10 'azurerm_role_assignment' .
```

## Network Configuration Inspection

```bash
# Overly permissive access to 0.0.0.0/0 (common across all providers)
grep -rn --include='*.tf' '0\.0\.0\.0/0' .

# ::/0 (IPv6 allow-all)
grep -rn --include='*.tf' '::/0' .

# VPC/VNet subnet configuration verification
grep -rn --include='*.tf' -B 5 -A 10 'cidr_block' .
```

## Logging and Audit Configuration Inspection

```bash
# CloudTrail configuration
grep -rn --include='*.tf' -B 5 -A 15 'aws_cloudtrail' . | grep -E '(is_multi_region|enable_log_file_validation)'

# VPC Flow Logs
grep -rn --include='*.tf' -B 5 -A 10 'aws_flow_log' .

# GCP Audit Logs
grep -rn --include='*.tf' -B 5 -A 10 'google_project_iam_audit_config' .

# Azure Diagnostic Settings
grep -rn --include='*.tf' -B 5 -A 10 'azurerm_monitor_diagnostic_setting' .
```

## Module Security

```bash
# Verify external module sources (unpinned versions)
grep -rn --include='*.tf' -E 'source\s*=\s*"(github|git::http|bitbucket|generic)' .

# Verify version pinning of registry modules
grep -rn --include='*.tf' -B 2 -A 5 'module\s+"' . | grep -E '(source|version)'

# Git sources without ref
grep -rn --include='*.tf' -E 'source\s*=\s*"git::' . | grep -v 'ref='
```

## Secret Detection

```bash
# Hardcoded sensitive information in .tf files
grep -rn --include='*.tf' --include='*.tfvars' \
  -iE '(password|secret|token|api_key|private_key|credentials)\s*=\s*"[^"$\{]' .

# AWS access key patterns
grep -rn --include='*.tf' --include='*.tfvars' \
  -E '(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}' .

# Base64-encoded credentials
grep -rn --include='*.tf' -E '[A-Za-z0-9+/]{40,}={0,2}' . | grep -iE '(key|secret|password|token)'

# Check if .tfvars is included in .gitignore
grep -n 'tfvars' .gitignore 2>/dev/null
```

## tfsec / checkov Integration

```bash
# Run tfsec
tfsec . --format json 2>/dev/null | jq '.results[] | {rule_id, severity, description, location}'

# tfsec Critical/High only
tfsec . --minimum-severity HIGH 2>/dev/null

# Run checkov
checkov -d . --framework terraform --output json 2>/dev/null | jq '.results.failed_checks[] | {check_id, check_type, name, guideline}'

# checkov CIS benchmark
checkov -d . --check-type terraform --framework terraform --compact 2>/dev/null
```

## Common Misconfigurations

| Severity | Misconfiguration | Impact |
|----------|------------------|--------|
| Critical | Plaintext secrets in state files | Credential leakage |
| Critical | Public ACL on S3 buckets | Full data exposure |
| Critical | `Action: "*"` in IAM policy | Full access to all AWS services |
| Critical | All ports open to 0.0.0.0/0 in Security Group | All ports exposed to the internet |
| High | Hardcoded passwords in .tf files | Credentials persisted in Git history |
| High | KMS key rotation not configured | Prolonged use of the same key |
| High | Public access enabled on RDS | Direct access to the database |
| High | CloudTrail multi-region disabled | Gaps in audit logs |
| Medium | Module version not pinned | Supply chain attack risk |
| Medium | EBS encryption not configured | Data leakage from physical media |
| Medium | VPC Flow Logs not configured | Unable to monitor network traffic |
| Medium | Provider version not pinned | Introduction of unexpected changes |
| Low | State file missing from .gitignore | Accidental commit of state files |
| Low | tfvars missing from .gitignore | Accidental commit of variable files |

## Security Checklist

### State Management
- [ ] Using a remote backend (S3/GCS/Azure Blob)
- [ ] State file encryption is enabled
- [ ] Access to state files is restricted via IAM
- [ ] No state files remain locally
- [ ] `*.tfstate*` is included in .gitignore

### Credentials
- [ ] No hardcoded credentials in .tf files
- [ ] Credentials managed via environment variables or Vault
- [ ] Provider uses assume_role
- [ ] .tfvars is included in .gitignore
- [ ] No AWS access keys in source code

### Network
- [ ] Ingress rules for 0.0.0.0/0 are minimized
- [ ] SSH (22) / RDP (3389) restricted to specific IPs
- [ ] VPC/VNet subnet design is appropriate
- [ ] VPC Flow Logs are enabled

### Encryption
- [ ] S3 bucket encryption is enabled
- [ ] EBS volume encryption is enabled
- [ ] RDS encryption is enabled
- [ ] KMS key rotation is enabled

### Logging and Audit
- [ ] CloudTrail is enabled in multi-region mode
- [ ] Log file validation is enabled
- [ ] VPC Flow Logs are configured
- [ ] Audit logs are properly stored

### Modules
- [ ] External module versions are pinned
- [ ] Module sources are from trusted registries/repositories
- [ ] Git sources have ref (commit hash) specified

### IaC Scanning
- [ ] tfsec or checkov is integrated into CI/CD
- [ ] Zero Critical/High findings
- [ ] Compliant with CIS benchmarks
