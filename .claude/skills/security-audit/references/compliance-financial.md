# Financial & Healthcare Compliance Reference

Code-level inspection guide based on compliance requirements for the financial and healthcare sectors.
Covers the major requirements of PCI-DSS v4.0, HIPAA, and SOX.

## PCI-DSS v4.0 (Payment Card Industry Data Security Standard)

Applies to systems that handle cardholder data. Focuses on violation patterns detectable at the code level.

### Requirement 3: Protection of Cardholder Data

PAN (Primary Account Number) must be encrypted or masked when stored. Only the first 6 digits / last 4 digits may be displayed.

```bash
# Detection of credit card number patterns (hardcoded in code)
grep -rn --include='*.{ts,js,py,rb,go,java,php}' \
  -E '[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}' . | grep -v node_modules

# PAN plaintext storage patterns
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(cardNumber|card_number|pan|creditCard|credit_card|ccNumber|cc_number)' . | \
  grep -v node_modules

# Locations where PAN is logged
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(console\.(log|info|warn|error)|logger\.|logging\.|log\.).*card' . | \
  grep -v node_modules

# Verify PAN masking implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(mask|truncate|redact).*card' .

# Verify encryption library usage
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(aes-256|AES_256|aes256|encrypt.*card|card.*encrypt)' .
```

### Requirement 4: Encryption of Transmission Channels

Transmission of cardholder data must be encrypted with TLS 1.2 or above.

```bash
# Detection of HTTP (non-HTTPS) communication
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -E "http://[^l][^o][^c][^a][^l]" . | grep -v node_modules | grep -v '\.test\.'

# Verify TLS version specification
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(TLSv1_0|TLSv1_1|SSLv3|ssl_version|minVersion.*TLS)' .

# SSL certificate verification disabled
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(rejectUnauthorized.*false|verify_ssl.*false|VERIFY_NONE|InsecureSkipVerify|NODE_TLS_REJECT_UNAUTHORIZED)' .
```

### Requirement 6: Secure System Development

Vulnerability management and secure coding practices are required.

```bash
# Known vulnerability check
npm audit --json 2>/dev/null | head -50

# Security-related TODO/FIXME
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(TODO|FIXME|HACK|XXX).*(security|vuln|auth|encrypt|password|token)' .

# Residual debug code
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(debugger|console\.debug|DEBUG\s*=\s*true|DEBUG_MODE)' . | grep -v node_modules
```

### Requirement 8: Authentication and Access Management

MFA implementation and password policy compliance are required.

```bash
# Verify password policy implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(password.*length|minLength.*password|passwordPolicy|password.*regex|password.*pattern)' .

# Verify MFA / 2FA implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(mfa|2fa|two.?factor|totp|authenticator|otp)' .

# Default passwords and hardcoded passwords
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE "(password\s*[:=]\s*['\"][^'\"]+['\"]|default.*password|admin.*password)" . | \
  grep -v node_modules | grep -v '\.test\.' | grep -v '\.spec\.'
```

### Requirement 10: Audit Logging

Logging of all access to cardholder data is required.

```bash
# Verify audit log implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(audit.?log|access.?log|activity.?log|event.?log)' .

# Verify logs do not contain sensitive data
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(log|logger|logging).*(password|secret|token|key|card|ssn|cvv)' . | \
  grep -v node_modules

# Log tamper protection (append-only, signed, etc.)
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(immutable|append.?only|tamper.?proof|log.*integrity)' .
```

### PCI-DSS Code Detection Patterns Summary

| Detection Target | Pattern | Severity |
|------------------|---------|----------|
| Hardcoded PAN | `[0-9]{4}[- ]?...` 16-digit pattern | Critical |
| PAN in log output | `log.*card` | Critical |
| CVV storage | `cvv`, `cvc`, `securityCode` stored in DB | Critical |
| HTTP communication | `http://` (except localhost) | High |
| SSL verification disabled | `rejectUnauthorized: false` | High |
| Default passwords | Hardcoded credentials | High |
| Missing audit logs | Absence of `audit`-related code | Medium |

---

## HIPAA (Health Insurance Portability and Accountability Act)

Applies to systems that handle PHI (Protected Health Information).

### PHI Identification and Protection

Detect data fields in code that qualify as PHI.

```bash
# Detection of PHI-related fields
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(patient|diagnosis|medical|health|treatment|prescription|medication|insurance|provider|ssn|social_security|dateOfBirth|dob|mrn|medical_record)' . | \
  grep -v node_modules

# Detection of ICD/CPT codes (medical codes)
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(icd.?code|cpt.?code|diagnosis.?code|procedure.?code)' .

# Detection of SSN patterns
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -E '[0-9]{3}-[0-9]{2}-[0-9]{4}' . | grep -v node_modules
```

### Encryption: At Rest and In Transit

PHI should be encrypted both at rest and in transit.

```bash
# Verify database encryption settings
grep -rn --include='*.{ts,js,py,rb,go,java,json,yaml,yml}' \
  -iE '(encrypt.*column|column.*encrypt|field.*encrypt|pgcrypto|TDE|transparent.*encrypt)' .

# Field-level encryption implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(encrypt.*patient|encrypt.*phi|encrypt.*health|encrypt.*medical)' .

# Encryption key management
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(KMS|key.?management|key.?vault|aws.?kms|azure.?keyvault|ENCRYPTION_KEY)' .
```

### Access Control and Audit Logging

RBAC (Role-Based Access Control) and audit records of all access are required.

```bash
# Verify RBAC implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(role|permission|rbac|access.?control|authorize|canAccess|hasPermission|checkRole)' .

# Audit logs for PHI access
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(audit|access.?log).*(patient|phi|medical|health)' .

# PHI exclusion from logs (log sanitization)
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(sanitize|redact|mask|filter).*(log|phi|patient)' .
```

### Minimum Necessary / BAA Compliance

Access to PHI must be restricted to the minimum necessary for business purposes. Third-party PHI transmission must also be verified.

```bash
# Use of SELECT * (potential Minimum Necessary violation)
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(SELECT\s+\*|findAll|find\(\)|\.all\(\))' . | \
  grep -iE '(patient|medical|health|record)'

# PHI leakage via third-party APIs / analytics
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(fetch|axios|http|analytics|tracking|gtag|segment)' . | \
  grep -iE '(patient|medical|health|diagnosis|ssn)'
```

### HIPAA Code Detection Patterns Summary

| Detection Target | Pattern | Severity |
|------------------|---------|----------|
| PHI in log output | `log.*(patient\|diagnosis\|ssn)` | Critical |
| PHI stored in plaintext | PHI fields without encryption | Critical |
| PHI encryption not implemented | Absence of encryption-related code | High |
| SELECT * retrieving PHI | `SELECT *` + medical tables | High |
| PHI sent to third parties | API calls + PHI data | High |
| RBAC not implemented | Absence of role/permission checks | High |
| Audit logging not implemented | Absence of PHI access logs | High |
| Hardcoded SSN | `[0-9]{3}-[0-9]{2}-[0-9]{4}` | Critical |
| PHI leakage via analytics | tracking + PHI fields | Medium |

---

## SOX (Sarbanes-Oxley Act)

Applies to systems related to financial reporting of publicly traded companies. Code is inspected from an IT General Controls (ITGC) perspective.

### Change Management

Code changes require proper review and approval.

```bash
# Verify merge restrictions (GitHub)
cat .github/CODEOWNERS 2>/dev/null
cat .github/branch-protection.json 2>/dev/null

# Verify PR review requirements
gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null | \
  grep -E '(required_approving_review_count|required_pull_request_reviews)'

# Detect direct commits to main/master
git log --oneline --first-parent main --no-merges --since='30 days ago' 2>/dev/null
```

### Access Control and Segregation of Duties

Access must be properly segregated across development, testing, and production environments.

```bash
# Verify environment separation
grep -rn --include='*.{ts,js,py,rb,go,java,json,yaml,yml}' \
  -iE '(NODE_ENV|RAILS_ENV|FLASK_ENV|APP_ENV|environment)' . | head -20

# Hardcoded production database connection strings
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(production|prod).*(host|url|connection|database)' . | \
  grep -v node_modules | grep -v '\.test\.' | grep -v '\.spec\.'

# Hardcoded admin privileges
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(isAdmin|is_admin|role.*admin|superuser|root.*access)' . | \
  grep -v node_modules
```

### Audit Trail and Log Integrity

Changes to financial data must be traceable.

```bash
# Verify audit trail implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(audit.?trail|change.?log|revision|history|versioning|temporal)' .

# Financial data-related fields
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(amount|balance|transaction|ledger|invoice|revenue|expense|financial)' .

# Change logs for financial data
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(update|modify|delete|remove).*(amount|balance|transaction|ledger|invoice)' .
```

### Financial Data Accuracy and Integrity

```bash
# Floating-point calculations for monetary amounts (precision issues)
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(float|double|parseFloat).*(amount|price|balance|total)' .

# Verify use of Decimal / BigNumber libraries
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(Decimal|BigNumber|BigInt|bignumber|decimal\.js|dinero|currency)' .

# Verify rounding logic
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(Math\.round|toFixed|ROUND_HALF|rounding)' . | \
  grep -iE '(amount|price|balance|total|currency)'
```

### SOX Code Detection Patterns Summary

| Detection Target | Pattern | Severity |
|------------------|---------|----------|
| Direct commits to main | Non-merge commits to main | High |
| Code review not enforced | Missing CODEOWNERS / PR rules | High |
| Hardcoded production DB connection | `production.*host` | Critical |
| Missing audit trail | Absence of audit-related code | High |
| Floating-point monetary calculations | `float.*amount` | Medium |
| Segregation of duties not implemented | No environment separation | High |
| Missing change logs for financial data | update + financial fields without logging | High |

---

## Integrated Compliance Checklist

### PCI-DSS Checklist

- [ ] PAN is not hardcoded in the codebase
- [ ] PAN is encrypted with AES-256 or above when stored
- [ ] PAN is masked to show only first 6 digits / last 4 digits when displayed
- [ ] CVV / CVC is never stored under any circumstances
- [ ] Cardholder data transmission is encrypted with TLS 1.2 or above
- [ ] SSL certificate verification is not disabled
- [ ] Vulnerabilities of all dependency packages have been reviewed
- [ ] Password policy is implemented with 12+ characters
- [ ] MFA is implemented for administrator accounts
- [ ] All access to cardholder data is recorded in audit logs
- [ ] PAN is not included in plaintext in audit logs
- [ ] No test card numbers remain in the production environment

### HIPAA Checklist

- [ ] PHI fields are identified and classified
- [ ] PHI is encrypted at rest
- [ ] PHI is encrypted in transit (TLS 1.2 or above)
- [ ] RBAC is implemented for PHI access
- [ ] Audit logs for PHI access are recorded
- [ ] Log output does not contain PHI (sanitization applied)
- [ ] Minimum Necessary is applied to API responses
- [ ] SELECT * is not used on PHI tables
- [ ] PHI transmission to third parties is limited to BAA-covered entities
- [ ] PHI is not sent to analytics / tracking services
- [ ] Session timeout is appropriately configured
- [ ] Backups containing PHI are encrypted

### SOX Checklist

- [ ] Direct commits to the main branch are restricted
- [ ] PR review is set as required
- [ ] CODEOWNERS is properly configured
- [ ] Development, testing, and production environments are separated
- [ ] Production environment credentials are not hardcoded in the codebase
- [ ] Financial data changes have an audit trail
- [ ] Decimal / BigNumber is used for monetary calculations (not floating-point)
- [ ] Admin privilege assignment is properly controlled
- [ ] A deployment approval workflow exists
- [ ] Log tamper protection measures are implemented
