# Next.js Security Testing Reference

Vulnerability patterns and testing guide specific to Next.js.

## Server Components / Client Components Data Leakage

### Risk

Props passed from Server Components to Client Components (`"use client"`) are serialized via the RSC protocol and sent to the browser. Raw database records and sensitive fields can be exposed.

### Detection Patterns

```bash
# List of Client Components
grep -rn '"use client"' --include='*.tsx' --include='*.ts' .

# Check props passed from Server Components to Client Components
# → Verify that the above files' props do not contain token, secret, password, apiKey

# Check usage of server-only package
grep -rn "import 'server-only'" --include='*.ts' --include='*.tsx' .

# process.env usage inside Client Components (dangerous)
grep -rn 'process\.env' --include='*.tsx' . | \
  xargs -I{} sh -c 'grep -l "use client" "$(echo "{}" | cut -d: -f1)" 2>/dev/null'
```

## Server Actions Security

Server Actions are **publicly exposed POST endpoints without authentication, authorization, or input validation**.

### 5 Mandatory Checks

1. **Authentication check**: Every Server Action must call `auth()` / `getServerSession()`
2. **Authorization check**: Verify resource ownership (prevent IDOR)
3. **Input validation**: Runtime validation with Zod etc. (TypeScript types are stripped at runtime)
4. **Rate limiting**: Use `@upstash/ratelimit` etc. for sensitive operations
5. **Closure leakage**: Values passed via `.bind()` are exposed to the client

### Detection Patterns

```bash
# List of Server Action files
grep -rn '"use server"' --include='*.ts' --include='*.tsx' .

# Server Action files without authentication checks
for f in $(grep -rl '"use server"' --include='*.ts' --include='*.tsx' .); do
  if ! grep -qE '(auth\(\)|getServerSession|getCurrentUser|verifySession)' "$f"; then
    echo "NO AUTH: $f"
  fi
done

# Server Actions without input validation
for f in $(grep -rl '"use server"' --include='*.ts' --include='*.tsx' .); do
  if ! grep -qE '(z\.|zod|schema\.(parse|safeParse)|validate|yup)' "$f"; then
    echo "NO VALIDATION: $f"
  fi
done

# .bind() usage (values are exposed to the client)
grep -rn '\.bind(null' --include='*.tsx' --include='*.ts' .
```

## Middleware Security

### CVE-2025-29927 (CVSS 9.1): Middleware Bypass

All Middleware can be bypassed via the `x-middleware-subrequest` header.

- Affected: Next.js <12.3.5, <13.5.9, <14.2.25, <15.2.3
- Vercel deployments are automatically protected. Self-hosted environments require patching

```bash
# Check Next.js version
cat node_modules/next/package.json 2>/dev/null | grep '"version"'
# or
grep '"next"' package.json
```

### Middleware Path Matching

```bash
# Check existence of middleware.ts/js and matcher configuration
find . -name 'middleware.ts' -o -name 'middleware.js' | head -5
grep -n 'matcher' middleware.ts 2>/dev/null || grep -n 'matcher' middleware.js 2>/dev/null
```

**Note**: Middleware is **not a security boundary**. Implement authorization checks in Route Handlers, Server Actions, and the Data Access Layer as well.

## next.config Security Settings

```bash
# Review entire next.config
cat next.config.ts 2>/dev/null || cat next.config.js 2>/dev/null || cat next.config.mjs 2>/dev/null

# Check security headers configuration
grep -A 20 'headers' next.config.* 2>/dev/null

# Image optimization remotePatterns (SSRF risk)
grep -A 10 'remotePatterns' next.config.* 2>/dev/null

# Wildcard hostnames (SSRF)
grep -E 'hostname.*\*\*' next.config.* 2>/dev/null

# dangerouslyAllowSVG (XSS risk)
grep 'dangerouslyAllowSVG' next.config.* 2>/dev/null

# Source maps exposed in production
grep 'productionBrowserSourceMaps' next.config.* 2>/dev/null
```

## Environment Variable Safety

```bash
# Sensitive information in NEXT_PUBLIC_ variables
grep -rn 'NEXT_PUBLIC_' .env* 2>/dev/null | \
  grep -iE '(SECRET|SK_|PASSWORD|TOKEN|CREDENTIAL|PRIVATE)'

# Check if .env files are tracked by Git
git ls-files .env .env.local .env.production .env.development 2>/dev/null
```

| Category | Behavior | Risk |
|----------|----------|------|
| `NEXT_PUBLIC_*` | Inlined into client JS at build time | Exposed to all users |
| Server-only variables | Accessible only on the server via `process.env` | Safe (as long as not passed to Client Components) |

## Input Validation and Injection

```bash
# SQL injection (raw queries)
grep -rn --include='*.{ts,tsx}' \
  -E '(sql`.*\$\{|\.raw\(|Prisma\.\$queryRaw|\.execute\()' . | grep -v node_modules

# Command injection
grep -rn --include='*.{ts,tsx}' \
  -E '(exec\(|execSync|spawn\(|child_process)' . | grep -v node_modules

# XSS patterns (direct DOM manipulation)
grep -rn --include='*.{ts,tsx}' \
  -E '(innerHTML|outerHTML|document\.write)' . | grep -v node_modules

# Open redirect
grep -rn --include='*.{ts,tsx}' \
  -E '(redirect\(|router\.push\(|router\.replace\()' . | \
  grep -v node_modules
```

## Image Optimization SSRF

The `/_next/image?url=<target>` endpoint fetches images on the server side.

```bash
# Overly permissive remotePatterns
grep -B2 -A10 'remotePatterns' next.config.* 2>/dev/null

# hostname: "**" allows fetching from any domain (Critical)
```

**Mitigation**: Strictly specify hostname, protocol, and path in `remotePatterns`.

## Notable CVE List

| CVE | Severity | Description | Fixed Version |
|-----|----------|-------------|---------------|
| CVE-2025-55182 | Critical (10.0) | RCE via RSC deserialization | Next.js 15.1.x+, React 19.0.1+ |
| CVE-2025-29927 | Critical (9.1) | Middleware authorization bypass | 14.2.25, 15.2.3 |
| CVE-2025-49826 | High (7.5) | ISR cache poisoning DoS | 15.1.8+ |
| CVE-2024-34351 | High | Host header SSRF | 14.1.1 |
| CVE-2024-46982 | High | Pages Router cache poisoning | 13.5.7, 14.2.10 |
| CVE-2026-27978 | Medium | Server Actions CSRF bypass | 2026 patch |

## Next.js Security Checklist

- [ ] Next.js version is at or above the fixed version for known CVEs
- [ ] All Server Actions have authentication, authorization, and input validation
- [ ] `NEXT_PUBLIC_` does not contain secret keys
- [ ] Security headers (CSP, HSTS, X-Frame-Options, etc.) are configured
- [ ] `remotePatterns` does not use wildcard hostnames
- [ ] `dangerouslyAllowSVG` is disabled
- [ ] `productionBrowserSourceMaps` is disabled
- [ ] Middleware is not the sole line of defense for authorization
- [ ] `.env` files are not tracked by Git
- [ ] `server-only` package is used in the data access layer
