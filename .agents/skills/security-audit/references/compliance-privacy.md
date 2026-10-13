# Privacy & Security Framework Compliance Reference

Code-level inspection guide based on privacy protection and security frameworks.
Covers the major requirements of GDPR, CCPA, SOC 2 Type II, and ISO 27001.

## GDPR (General Data Protection Regulation)

Applies to systems that process personal data of EU residents. Based on the principle of Privacy by Design.

### Data Subject Rights

Inspect implementation of Right to Erasure, Right to Portability, and Right of Access.

```bash
# Verify data deletion functionality implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(deleteUser|delete.?account|erase|purge|forget.?me|right.?to.?erasure|gdpr.?delete)' .

# Data export / portability functionality
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(export.?data|download.?data|portability|data.?export|user.?data.?download)' .

# Data access requests (SAR: Subject Access Request)
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(subject.?access|data.?access.?request|sar|dsar|get.?my.?data)' .

# Verify soft delete vs. hard delete
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(soft.?delete|is.?deleted|deleted.?at|paranoid|withDeleted)' .
```

### Consent Management

Inspect consent acquisition and withdrawal mechanisms for data processing.

```bash
# Consent flags and consent management implementation
grep -rn --include='*.{ts,js,py,rb,go,java,tsx,jsx}' \
  -iE '(consent|opt.?in|opt.?out|cookie.?consent|cookie.?banner|accept.?cookies)' .

# Consent timestamp recording
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(consent.?date|consent.?timestamp|consented.?at|consent.?version)' .

# Tracking without consent (potential violation)
grep -rn --include='*.{ts,js,tsx,jsx,html}' \
  -iE '(gtag|ga\(|analytics|fbq|_paq|hotjar|segment\.track)' . | \
  grep -v node_modules | head -20
```

### Data Minimization and Privacy by Design

Detect unnecessary data collection and verify data protection design.

```bash
# Excessive form field collection (special category data)
grep -rn --include='*.{ts,js,tsx,jsx,html}' \
  -iE '(gender|ethnicity|race|religion|political|sexual|biometric|genetic)' . | \
  grep -iE '(input|field|form|register|signup)'

# Data retention period implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(retention|expiry|expire|ttl|purge.?after|delete.?after|data.?lifecycle)' .

# Anonymization and pseudonymization implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(anonymize|pseudonymize|de.?identify|tokenize|hash.?pii)' .
```

### GDPR Code Detection Patterns Summary

| Detection Target | Pattern | Severity |
|------------------|---------|----------|
| Missing data deletion functionality | Absence of `deleteUser` etc. | Critical |
| Tracking without consent | Analytics without consent check | Critical |
| Consent timestamp not recorded | Absence of `consentDate` | High |
| Soft delete only (no hard delete) | Only `softDelete` present | High |
| Data retention period not set | Absence of `retention`-related code | High |
| Excessive data collection | Unnecessary PII fields | Medium |
| Missing export functionality | Absence of `exportData` etc. | High |

---

## CCPA (California Consumer Privacy Act)

Applies to systems that handle personal information of California residents.

### Consumer Rights and Do Not Sell

Verify implementation of opt-out, data deletion, and "Do Not Sell" mechanisms.

```bash
# Opt-out / Do Not Sell functionality implementation
grep -rn --include='*.{ts,js,py,rb,go,java,tsx,jsx}' \
  -iE '(opt.?out|do.?not.?sell|do.?not.?share|ccpa|privacy.?choice)' .

# Data deletion request functionality
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(delete.?request|deletion.?request|ccpa.?delete|consumer.?delete)' .

# Data sharing with third parties
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(share.?data|sell.?data|third.?party|data.?broker|data.?partner)' .

# GPC (Global Privacy Control) header support
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(globalPrivacyControl|Sec-GPC|gpc.?header|navigator\.globalPrivacyControl)' .

# Privacy policy page
grep -rn --include='*.{ts,js,tsx,jsx,html}' \
  -iE '(privacy.?policy|privacy.?notice|privacy.?settings)' .
```

### CCPA Code Detection Patterns Summary

| Detection Target | Pattern | Severity |
|------------------|---------|----------|
| Missing opt-out functionality | Absence of `opt-out`-related code | Critical |
| Missing "Do Not Sell" link | Absence of `doNotSell` | Critical |
| GPC header not supported | Absence of `Sec-GPC` handling | High |
| Missing data deletion functionality | Absence of deletion request handling | High |
| Unmanaged third-party sharing | No control over sharing destinations | High |

---

## SOC 2 Type II

Inspect code-level controls based on the 5 Trust Services Criteria (TSC).

### Security

```bash
# Verify authentication and authorization implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(authenticate|login|signIn|verifyToken|authorize|permission|guard|canActivate)' .

# Session management
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(session.?timeout|idle.?timeout|max.?age|expires.?in|token.?expiry)' .

# Input validation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(validate|sanitize|escape|parameterize|prepared.?statement)' .
```

### Availability

```bash
# Health check and retry implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(health.?check|healthCheck|readiness|liveness|retry|circuit.?breaker|fallback)' .

# Backup and restore related
grep -rn --include='*.{ts,js,py,rb,go,java,yaml,yml,json}' \
  -iE '(backup|restore|disaster.?recovery|failover|replication)' .
```

### Processing Integrity

```bash
# Schema validation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(schema.?validation|zod|joi|yup|class-validator|marshmallow|pydantic)' .

# Transaction management and integrity verification
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(transaction|commit|rollback|atomic|checksum|integrity|hmac)' .
```

### Confidentiality / Privacy

```bash
# Encryption and secret management
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(encrypt|decrypt|cipher|aes|vault|secret.?manager|aws.?secrets|key.?vault)' . | \
  grep -v node_modules | head -20

# PII field detection
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(email|phone|address|firstName|first_name|lastName|last_name|dateOfBirth|ssn|passport)' . | \
  grep -v node_modules | grep -v '\.test\.' | head -20

# PII masking and redaction
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(mask|redact|encrypt|hash).*(email|phone|name|address|ssn)' .
```

### SOC 2 Code Detection Patterns Summary

| TSC | Detection Target | Pattern | Severity |
|-----|------------------|---------|----------|
| Security | Missing authentication | Absence of `authenticate`-related code | Critical |
| Security | Missing authorization | Absence of `authorize`-related code | Critical |
| Security | Missing input validation | Absence of `validate`-related code | High |
| Availability | Missing health check | Absence of `healthCheck` | Medium |
| Integrity | Missing schema validation | Absence of `zod`/`joi` etc. | High |
| Confidentiality | Missing encryption | Absence of `encrypt`-related code | High |
| Privacy | Missing PII masking | Absence of `mask`/`redact` | High |

---

## ISO 27001

Code-level inspection based on the Annex A controls of the Information Security Management System (ISMS).

### A.8 Asset Management / A.9 Access Control

```bash
# Data classification level implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(data.?classification|security.?level|confidential|restricted|top.?secret)' .

# Access control policies and least privilege
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(access.?control|acl|rbac|abac|policy.?engine|least.?privilege|scoped.?token)' .

# Privileged access management
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(privileged|sudo|root|admin.?access|elevated|superuser|impersonate)' .

# Password hashing implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(bcrypt|scrypt|argon2|pbkdf2|password.?hash|password.?policy)' .
```

### A.10 Cryptography

```bash
# Verify cryptographic algorithm usage
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(aes|rsa|ecdsa|ed25519|chacha20|sha256|sha512)' . | grep -v node_modules

# Detect weak cryptographic algorithms
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(md5|sha1[^0-9]|des[^a-z]|rc4|blowfish|createCipher\b)' . | grep -v node_modules

# Detect hardcoded cryptographic keys
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(PRIVATE_KEY|SECRET_KEY|ENCRYPTION_KEY|API_KEY)\s*[:=]\s*["\x27]' . | \
  grep -v node_modules | grep -v '\.env\.example'

# Key management service usage
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(kms|key.?management|key.?rotation|key.?vault|hsm)' .
```

### A.12 Operational Security / A.14 System Development Security

```bash
# Structured logging implementation
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(winston|pino|bunyan|log4j|logback|slog|zerolog|structlog)' .

# Security event logging
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(security.?event|auth.?log|login.?log|access.?denied|unauthorized)' .

# File upload verification
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(file.?type|mime.?type|magic.?bytes|virus.?scan|malware.?scan|clamav)' .

# CI/CD security scanning
cat .github/workflows/*.yml 2>/dev/null | \
  grep -iE '(npm audit|snyk|dependabot|codeql|semgrep|sonarqube|trivy)'
```

### ISO 27001 Code Detection Patterns Summary

| Annex A | Detection Target | Pattern | Severity |
|---------|------------------|---------|----------|
| A.8 | Missing data classification | Absence of `classification` | Medium |
| A.9 | Missing access control | Absence of `rbac`/`acl` | High |
| A.9 | Unmanaged privileged access | Hardcoded `admin` | High |
| A.10 | Weak cryptographic algorithms | `MD5`/`SHA1`/`DES` | High |
| A.10 | Hardcoded cryptographic keys | `SECRET_KEY = "..."` | Critical |
| A.10 | Missing key management | Absence of `KMS`-related code | High |
| A.12 | Missing structured logging | Absence of logging libraries | Medium |
| A.14 | Missing security scanning | Absence of SAST/DAST | High |

---

## Integrated Compliance Checklist

### GDPR Checklist

- [ ] Data deletion functionality (Right to Erasure) is implemented
- [ ] Data export functionality (Right to Portability) is implemented
- [ ] Data access request (SAR) processing is implemented
- [ ] Consent acquisition mechanism is implemented
- [ ] Consent withdrawal is possible
- [ ] Consent acquisition timestamps are recorded
- [ ] Tracking does not begin before consent is obtained
- [ ] Data retention periods are defined and implemented
- [ ] Only the minimum necessary data is collected in accordance with the data minimization principle
- [ ] PII anonymization and pseudonymization are properly implemented

### CCPA Checklist

- [ ] "Do Not Sell or Share My Personal Information" link is implemented
- [ ] Opt-out mechanism is functional
- [ ] GPC (Global Privacy Control) header is supported
- [ ] Data deletion request processing is implemented
- [ ] Privacy policy is properly linked
- [ ] Data sharing with third parties is managed

### SOC 2 Type II Checklist

- [ ] Authentication mechanism is implemented for all endpoints
- [ ] Authorization checks are implemented at the resource level
- [ ] Session timeout is appropriately configured
- [ ] Input validation is applied to all user inputs
- [ ] Health check endpoint is implemented
- [ ] Schema validation is in use
- [ ] Transaction management is properly implemented
- [ ] Sensitive data is encrypted
- [ ] Secret management tools are in use
- [ ] PII masking and redaction are implemented
- [ ] Audit logs are properly recorded

### ISO 27001 Checklist

- [ ] Information asset classification is implemented
- [ ] Access control policies are implemented (RBAC/ABAC)
- [ ] Principle of least privilege is applied
- [ ] Privileged access is properly managed
- [ ] Only strong cryptographic algorithms are used (AES-256, SHA-256 or above)
- [ ] Cryptographic keys are not hardcoded in the codebase
- [ ] Key Management Service (KMS) is in use
- [ ] Structured logging is implemented
- [ ] Security events are recorded
- [ ] Security scanning is included in the CI/CD pipeline
- [ ] Dependency vulnerability scanning is automated
