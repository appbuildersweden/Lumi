# AWS Security Testing Reference

Security inspection guide based on the AWS Well-Architected Framework Security Pillar.
Verify compliance with the CIS AWS Foundations Benchmark through automated inspection using AWS CLI commands.

## IAM Inspection

### Root Account and MFA

```bash
# Verify root account MFA status (CIS 1.5)
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'

# Verify root account access keys (CIS 1.4 - should be disabled)
aws iam get-account-summary --query 'SummaryMap.AccountAccessKeysPresent'

# List users without MFA configured (CIS 1.10)
aws iam generate-credential-report > /dev/null 2>&1
aws iam get-credential-report --output text --query 'Content' | base64 -d | \
  awk -F, '$4 == "true" && $8 == "false" {print $1}'
```

### Access Key Management

```bash
# Access keys not rotated for 90+ days (CIS 1.14)
aws iam generate-credential-report > /dev/null 2>&1
aws iam get-credential-report --output text --query 'Content' | base64 -d | \
  awk -F, 'NR>1 && $9 == "true" {print $1, $10}'

# Unused access keys (not used for 90+ days - CIS 1.12)
aws iam generate-credential-report > /dev/null 2>&1
aws iam get-credential-report --output text --query 'Content' | base64 -d | \
  awk -F, 'NR>1 && $9 == "true" && $11 != "N/A" {print $1, $11}'

# Users with multiple active access keys
for user in $(aws iam list-users --query 'Users[].UserName' --output text); do
  count=$(aws iam list-access-keys --user-name "$user" --query 'length(AccessKeyMetadata[?Status==`Active`])' --output text)
  [ "$count" -gt 1 ] && echo "WARNING: $user has $count active keys"
done
```

### IAM Policies

```bash
# Users/roles with AdministratorAccess
aws iam list-entities-for-policy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess \
  --query '{Users: PolicyUsers, Roles: PolicyRoles, Groups: PolicyGroups}'

# Custom policies containing wildcard actions ("*")
for arn in $(aws iam list-policies --scope Local --query 'Policies[].Arn' --output text); do
  version=$(aws iam get-policy --policy-arn "$arn" --query 'Policy.DefaultVersionId' --output text)
  aws iam get-policy-version --policy-arn "$arn" --version-id "$version" --query 'PolicyVersion.Document' --output json | \
    grep -l '"Action": "\*"' 2>/dev/null && echo "WILDCARD: $arn"
done

# Users with inline policies (group policies recommended)
for user in $(aws iam list-users --query 'Users[].UserName' --output text); do
  policies=$(aws iam list-user-policies --user-name "$user" --query 'PolicyNames' --output text)
  [ -n "$policies" ] && echo "INLINE POLICY: $user - $policies"
done

# Verify password policy (CIS 1.8-1.11)
aws iam get-account-password-policy 2>/dev/null
```

## S3 Inspection

### Public Access

```bash
# Account-level public access block (CIS 2.1.5)
aws s3control get-public-access-block --account-id $(aws sts get-caller-identity --query Account --output text) 2>/dev/null

# Verify public access block for all buckets
for bucket in $(aws s3api list-buckets --query 'Buckets[].Name' --output text); do
  echo "=== $bucket ==="
  aws s3api get-public-access-block --bucket "$bucket" 2>/dev/null || echo "NOT CONFIGURED"
done

# Buckets with public ACLs
for bucket in $(aws s3api list-buckets --query 'Buckets[].Name' --output text); do
  acl=$(aws s3api get-bucket-acl --bucket "$bucket" --query 'Grants[?Grantee.URI==`http://acs.amazonaws.com/groups/global/AllUsers` || Grantee.URI==`http://acs.amazonaws.com/groups/global/AuthenticatedUsers`]' --output text)
  [ -n "$acl" ] && echo "PUBLIC: $bucket"
done
```

### S3 Encryption and Logging

```bash
# Verify bucket encryption (CIS 2.1.1)
for bucket in $(aws s3api list-buckets --query 'Buckets[].Name' --output text); do
  aws s3api get-bucket-encryption --bucket "$bucket" 2>/dev/null || echo "NO ENCRYPTION: $bucket"
done

# Verify versioning
for bucket in $(aws s3api list-buckets --query 'Buckets[].Name' --output text); do
  status=$(aws s3api get-bucket-versioning --bucket "$bucket" --query 'Status' --output text)
  [ "$status" != "Enabled" ] && echo "VERSIONING OFF: $bucket"
done

# Verify access logging (CIS 2.1.3)
for bucket in $(aws s3api list-buckets --query 'Buckets[].Name' --output text); do
  aws s3api get-bucket-logging --bucket "$bucket" --query 'LoggingEnabled' 2>/dev/null || echo "NO LOGGING: $bucket"
done

# Verify SSL enforcement policy
for bucket in $(aws s3api list-buckets --query 'Buckets[].Name' --output text); do
  aws s3api get-bucket-policy --bucket "$bucket" --output text 2>/dev/null | \
    grep -q 'aws:SecureTransport.*false' || echo "NO SSL ENFORCEMENT: $bucket"
done
```

## VPC Inspection

### Security Groups

```bash
# Security Groups with all ports open (CIS 5.1-5.4)
aws ec2 describe-security-groups \
  --filters Name=ip-permission.cidr,Values=0.0.0.0/0 \
  --query 'SecurityGroups[].{ID:GroupId, Name:GroupName, Rules:IpPermissions[?contains(IpRanges[].CidrIp, `0.0.0.0/0`)]}'

# Security Groups with SSH (22) open to all
aws ec2 describe-security-groups \
  --filters Name=ip-permission.from-port,Values=22 Name=ip-permission.cidr,Values=0.0.0.0/0 \
  --query 'SecurityGroups[].{ID:GroupId, Name:GroupName}'

# Security Groups with RDP (3389) open to all
aws ec2 describe-security-groups \
  --filters Name=ip-permission.from-port,Values=3389 Name=ip-permission.cidr,Values=0.0.0.0/0 \
  --query 'SecurityGroups[].{ID:GroupId, Name:GroupName}'

# Rules remaining in default Security Groups (CIS 5.4)
for vpc in $(aws ec2 describe-vpcs --query 'Vpcs[].VpcId' --output text); do
  aws ec2 describe-security-groups --filters Name=vpc-id,Values=$vpc Name=group-name,Values=default \
    --query 'SecurityGroups[?length(IpPermissions) > `0` || length(IpPermissionsEgress) > `0`].{VPC: VpcId, SG: GroupId}'
done
```

### VPC Flow Logs and NACLs

```bash
# Verify VPC Flow Logs are enabled (CIS 3.9)
for vpc in $(aws ec2 describe-vpcs --query 'Vpcs[].VpcId' --output text); do
  logs=$(aws ec2 describe-flow-logs --filter Name=resource-id,Values=$vpc --query 'FlowLogs[].FlowLogId' --output text)
  [ -z "$logs" ] && echo "NO FLOW LOGS: $vpc"
done

# Verify VPC endpoints
aws ec2 describe-vpc-endpoints --query 'VpcEndpoints[].{VPC:VpcId, Service:ServiceName, Type:VpcEndpointType}'
```

## EC2 Inspection

```bash
# Verify IMDSv2 enforcement (CIS 5.6)
aws ec2 describe-instances \
  --query 'Reservations[].Instances[].{ID:InstanceId, IMDS:MetadataOptions.HttpTokens}' | \
  grep -B1 'optional'

# EBS encryption default setting
aws ec2 get-ebs-encryption-by-default --query 'EbsEncryptionByDefault'

# Unencrypted EBS volumes
aws ec2 describe-volumes \
  --filters Name=encrypted,Values=false \
  --query 'Volumes[].{ID:VolumeId, State:State, Size:Size}'

# Verify public AMIs
aws ec2 describe-images --owners self \
  --query 'Images[?Public==`true`].{ID:ImageId, Name:Name}'
```

## RDS Inspection

```bash
# Publicly accessible RDS instances
aws rds describe-db-instances \
  --query 'DBInstances[?PubliclyAccessible==`true`].{ID:DBInstanceIdentifier, Engine:Engine}'

# Unencrypted RDS instances (CIS 2.3.1)
aws rds describe-db-instances \
  --query 'DBInstances[?StorageEncrypted==`false`].{ID:DBInstanceIdentifier, Engine:Engine}'

# Verify automated backups
aws rds describe-db-instances \
  --query 'DBInstances[?BackupRetentionPeriod==`0`].{ID:DBInstanceIdentifier, Engine:Engine}'

# Verify deletion protection
aws rds describe-db-instances \
  --query 'DBInstances[?DeletionProtection==`false`].{ID:DBInstanceIdentifier, Engine:Engine}'

# Verify SSL enforcement
for id in $(aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text); do
  pg=$(aws rds describe-db-instances --db-instance-identifier "$id" --query 'DBInstances[0].DBParameterGroups[0].DBParameterGroupName' --output text)
  aws rds describe-db-parameters --db-parameter-group-name "$pg" --query 'Parameters[?ParameterName==`rds.force_ssl`].{Name:ParameterName, Value:ParameterValue}'
done
```

## Lambda Inspection

```bash
# Verify Lambda function execution roles
aws lambda list-functions \
  --query 'Functions[].{Name:FunctionName, Role:Role, Runtime:Runtime}'

# Detect secrets in environment variables
for fn in $(aws lambda list-functions --query 'Functions[].FunctionName' --output text); do
  aws lambda get-function-configuration --function-name "$fn" \
    --query 'Environment.Variables' 2>/dev/null | \
    grep -iE '(password|secret|token|key|credential)' && echo "  -> $fn"
done

# Lambda functions without VPC configuration
aws lambda list-functions \
  --query 'Functions[?VpcConfig.VpcId==`null` || VpcConfig.VpcId==``].FunctionName'
```

## KMS Inspection

```bash
# Verify key rotation (CIS 3.8)
for key in $(aws kms list-keys --query 'Keys[].KeyId' --output text); do
  rotation=$(aws kms get-key-rotation-status --key-id "$key" --query 'KeyRotationEnabled' --output text 2>/dev/null)
  [ "$rotation" = "false" ] && echo "NO ROTATION: $key"
done

# Verify key policies (overly broad access)
for key in $(aws kms list-keys --query 'Keys[].KeyId' --output text); do
  aws kms get-key-policy --key-id "$key" --policy-name default --output text 2>/dev/null | \
    grep -q '"Principal": "\*"' && echo "WILDCARD PRINCIPAL: $key"
done
```

## CloudTrail Inspection

```bash
# Verify CloudTrail configuration (CIS 3.1-3.4)
aws cloudtrail describe-trails --query 'trailList[].{Name:Name, IsMultiRegion:IsMultiRegionTrail, LogValidation:LogFileValidationEnabled, S3Bucket:S3BucketName, KmsKey:KmsKeyId}'

# Verify CloudTrail is enabled
aws cloudtrail get-trail-status --name $(aws cloudtrail describe-trails --query 'trailList[0].Name' --output text) \
  --query '{IsLogging:IsLogging, LatestDeliveryTime:LatestDeliveryTime}'

# Verify CloudTrail log S3 bucket is not public
trail_bucket=$(aws cloudtrail describe-trails --query 'trailList[0].S3BucketName' --output text)
aws s3api get-bucket-acl --bucket "$trail_bucket" --query 'Grants[?Grantee.URI!=`null`]'
```

## GuardDuty Inspection

```bash
# Verify GuardDuty is enabled (CIS 4.15)
aws guardduty list-detectors --query 'DetectorIds'

# GuardDuty findings (High and above)
detector_id=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)
aws guardduty list-findings --detector-id "$detector_id" \
  --finding-criteria '{"Criterion":{"severity":{"Gte":7}}}' 2>/dev/null
```

## Secrets Manager Inspection

```bash
# Secrets without rotation configured
aws secretsmanager list-secrets \
  --query 'SecretList[?RotationEnabled==`false`].{Name:Name, LastChanged:LastChangedDate}'

# Verify rotation schedule
aws secretsmanager list-secrets \
  --query 'SecretList[].{Name:Name, RotationEnabled:RotationEnabled, RotationDays:RotationRules.AutomaticallyAfterDays}'
```

## WAF Inspection

```bash
# List WAF WebACLs
aws wafv2 list-web-acls --scope REGIONAL --query 'WebACLs[].{Name:Name, ID:Id}'

# Verify managed rule groups
for acl_id in $(aws wafv2 list-web-acls --scope REGIONAL --query 'WebACLs[].Id' --output text); do
  acl_name=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[?Id=='$acl_id'].Name" --output text)
  aws wafv2 get-web-acl --scope REGIONAL --name "$acl_name" --id "$acl_id" \
    --query 'WebACL.Rules[].{Name:Name, Priority:Priority}' 2>/dev/null
done

# Verify rate limiting rules
aws wafv2 list-web-acls --scope REGIONAL --query 'WebACLs[].Name' --output text
```

## ECS/EKS Inspection

```bash
# Verify privileged mode in ECS task definitions
for td in $(aws ecs list-task-definitions --query 'taskDefinitionArns' --output text); do
  aws ecs describe-task-definition --task-definition "$td" \
    --query 'taskDefinition.containerDefinitions[?privileged==`true`].name' --output text | \
    grep -v '^$' && echo "PRIVILEGED: $td"
done

# Verify EKS cluster RBAC
for cluster in $(aws eks list-clusters --query 'clusters' --output text); do
  aws eks describe-cluster --name "$cluster" \
    --query 'cluster.{Name:name, Endpoint:endpoint, PublicAccess:resourcesVpcConfig.endpointPublicAccess}'
done
```

## Codebase Static Analysis

```bash
# Hardcoded AWS access keys
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java,rb}' \
  -E '(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}' . | grep -v node_modules

# AWS secret key patterns
grep -rn --include='*.{ts,tsx,js,jsx,py,go,java,rb}' \
  -E '[A-Za-z0-9/+=]{40}' . | grep -iE '(aws_secret|secret_access)' | grep -v node_modules

# AWS credentials in .env files
grep -rn -E '(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)' .env* 2>/dev/null
```

## Common Misconfigurations

| Severity | Misconfiguration | CIS | Impact |
|----------|------------------|-----|--------|
| Critical | Access keys on root account | 1.4 | Full access to all resources |
| Critical | S3 bucket publicly exposed | 2.1.5 | Full data exposure |
| Critical | `*` action in IAM policy | - | Excessive permissions |
| Critical | All ports open in Security Group | 5.1 | All services exposed to the internet |
| High | MFA not configured on root account | 1.5 | Account takeover risk |
| High | CloudTrail not enabled | 3.1 | Lack of audit trail |
| High | RDS publicly accessible | - | Direct database access |
| High | IMDSv2 not enforced | 5.6 | Credential theft via SSRF |
| High | KMS key rotation not configured | 3.8 | Prolonged use of the same key |
| Medium | EBS encryption not configured | 2.2.1 | Volume data leakage |
| Medium | VPC Flow Logs not configured | 3.9 | Unable to monitor network |
| Medium | GuardDuty not enabled | 4.15 | Lack of threat detection |
| Medium | Secrets Manager rotation not configured | - | Static credentials |
| Low | Rules remaining in default SG | 5.4 | Unintended access permissions |

## Security Checklist

### IAM (CIS 1.x)
- [ ] Root account access keys are disabled
- [ ] MFA is configured on the root account
- [ ] MFA is configured for all IAM users
- [ ] Access keys are rotated within 90 days
- [ ] Password policy meets CIS standards
- [ ] Group policies are used instead of inline policies
- [ ] Principle of least privilege is applied

### S3 (CIS 2.1.x)
- [ ] Account-level public access block is enabled
- [ ] Encryption is enabled for all buckets
- [ ] Bucket access logging is enabled
- [ ] SSL enforcement policy is configured
- [ ] Versioning is enabled

### Network (CIS 5.x)
- [ ] SSH (22) is restricted to specific IPs
- [ ] RDP (3389) is restricted to specific IPs
- [ ] No rules remaining in default Security Groups
- [ ] VPC Flow Logs are enabled
- [ ] Required VPC endpoints are configured

### Logging and Monitoring (CIS 3.x / 4.x)
- [ ] CloudTrail is enabled in multi-region mode
- [ ] Log file validation is enabled
- [ ] CloudTrail log S3 bucket is not public
- [ ] GuardDuty is enabled
- [ ] No High or above GuardDuty findings

### Data Protection
- [ ] RDS encryption is enabled
- [ ] EBS encryption is enabled by default
- [ ] KMS key rotation is enabled
- [ ] Secrets Manager rotation is configured
- [ ] No hardcoded secrets in Lambda environment variables

### Compute
- [ ] IMDSv2 is enforced on EC2 instances
- [ ] Lambda functions are placed in appropriate VPCs
- [ ] ECS tasks are not running in privileged mode
- [ ] EKS public endpoints are restricted
