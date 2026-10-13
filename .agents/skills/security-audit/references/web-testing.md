# Web Security Testing Reference

Detailed testing guide based on OWASP WSTG + Top 10:2025.

## WSTG Test Categories

### WSTG-INFO: Information Gathering

- Web server fingerprinting
- Information leakage in metadata and comments
- Entry point enumeration
- Application mapping

### WSTG-CONF: Configuration and Deployment

Inspection Targets:
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- CORS configuration (wildcard origin detection)
- HTTP methods (disabling unnecessary PUT/DELETE/TRACE)
- Default credentials
- Admin panel exposure
- Information disclosure in error pages
- Exposure of .env / .git / backup files

```bash
# Security header detection patterns
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(helmet|SecurityHeaders|Content-Security-Policy|X-Frame-Options)' .

# CORS wildcard detection
grep -rn --include='*.{ts,js,py,rb,go,json,yaml,yml}' \
  -E "(origin:\s*['\"]?\*|Access-Control-Allow-Origin.*\*|cors.*\*)" .
```

### WSTG-ATHN: Authentication

Inspection Targets:
- Password policy (minimum length, complexity)
- Brute force protection (rate limiting, account lockout)
- Password reset flow security
- Session fixation attacks
- Multi-factor authentication bypass
- JWT validation flaws (alg: none, key exposure, expiration not verified)

```bash
# JWT validation patterns
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(jwt\.(verify|decode|sign)|jsonwebtoken|PyJWT|jose)' .

# Detection of alg: none acceptance
grep -rn --include='*.{ts,js,py}' \
  -E '(algorithms.*none|ignoreExpiration.*true|verify.*false)' .
```

### WSTG-ATHZ: Authorization

Inspection Targets:
- IDOR (Insecure Direct Object Reference)
- Vertical privilege escalation (regular user -> admin)
- Horizontal privilege escalation (User A -> User B's resources)
- Path traversal (accessing restricted areas via `../`)
- Missing authorization checks on API endpoints

```bash
# Parameter-based object reference detection
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(params\.(id|userId|user_id)|req\.(params|query)\[.*(id|Id)\]|request\.(args|form)\[)' .

# Missing authorization middleware detection (Express/Koa/Fastify)
grep -rn --include='*.{ts,js}' \
  -E '(router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete))' . | \
  grep -v -E '(auth|middleware|guard|protect|verify|check)'
```

### WSTG-INPV: Input Validation

Inspection Targets:
- SQL/NoSQL injection
- Command injection
- XSS (Reflected, Stored, DOM-based)
- SSTI (Server-Side Template Injection)
- SSRF (Server-Side Request Forgery)
- Parameter pollution
- Mass Assignment

```bash
# SQL injection risk patterns
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(query\(.*\$\{|query\(.*\+.*req\.|execute\(.*%s|\.raw\(|\.exec\(.*\+)' .

# Command injection
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(child_process|exec\(|execSync|spawn|system\(|popen|subprocess|os\.system)' .

# eval / Function constructor
grep -rn --include='*.{ts,js,tsx,jsx}' \
  -E '(eval\(|new\s+Function\()' . | grep -v 'node_modules'

# DOM-based XSS patterns (direct DOM manipulation such as innerHTML)
grep -rn --include='*.{ts,js,tsx,jsx}' \
  -E '(innerHTML|outerHTML|document\.write|v-html|bypassSecurityTrust)' .
```

### WSTG-SESS: Session Management

Inspection Targets:
- Cookie attributes (Secure, HttpOnly, SameSite, Path, Domain)
- Sufficient entropy in session IDs
- Session timeout
- CSRF token implementation
- Session invalidation on logout

```bash
# Check Cookie configuration
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(setCookie|set-cookie|cookie\(|session\(|httpOnly|sameSite|secure:)' .

# CSRF token detection
grep -rn --include='*.{ts,js,py,rb,go,html}' \
  -E '(csrf|_token|authenticity_token|X-CSRF|xsrf)' .
```

### WSTG-CRYP: Cryptography

Inspection Targets:
- Use of TLS 1.2 or higher
- Weak cryptographic algorithms (MD5, SHA1, DES, RC4)
- Password hashing (use of bcrypt/scrypt/Argon2)
- Hardcoded cryptographic keys

```bash
# Weak cryptographic algorithms
grep -rn --include='*.{ts,js,py,rb,go,swift}' \
  -iE '(md5|sha1[^0-9]|des[^a-z]|rc4|createCipher\b)' . | \
  grep -v 'node_modules'

# Password hashing check
grep -rn --include='*.{ts,js,py,rb,go}' \
  -iE '(bcrypt|scrypt|argon2|pbkdf2|hashpw)' .
```

### WSTG-APIT: API Testing

Inspection Targets:
- Excessive data exposure (unnecessary fields in responses)
- BOLA/BFLA (Broken Object/Function Level Authorization)
- Missing rate limiting
- GraphQL: Introspection enabled, nesting attacks
- API versioning and deprecated endpoints

```bash
# GraphQL introspection
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(introspection|__schema|__type)' .

# Rate limiting implementation check
grep -rn --include='*.{ts,js,py,rb,go}' \
  -iE '(rate.?limit|throttle|express-rate|slowDown|limiter)' .
```

## OWASP Top 10:2025 Quick Reference

| Rank | Category | Key Detection Patterns |
|------|----------|------------------------|
| A01 | Broken Access Control | Missing authorization checks, IDOR, path traversal |
| A02 | Security Misconfiguration | Default settings, unnecessary services, error disclosure |
| A03 | Supply Chain Failures | Dependencies with known vulnerabilities |
| A04 | Cryptographic Failures | Weak encryption, cleartext communication, hardcoded keys |
| A05 | Injection | SQL/NoSQL/Command/XSS/SSTI |
| A06 | Insecure Design | Lack of threat modeling, business logic flaws |
| A07 | Authentication Failures | Weak password policy, session management flaws |
| A08 | Integrity Failures | CI/CD tampering, lack of dependency verification |
| A09 | Logging Failures | Missing audit logs, sensitive data in log output |
| A10 | Exception Handling | Fail-open behavior, stack trace exposure |
