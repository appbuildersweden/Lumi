# Vercel Security Testing Reference

Infrastructure and configuration-level security testing guide for Vercel.
Combines items that can be retrieved via CLI/API with dashboard inspection via Chrome MCP.

## CLI-Based Automated Inspection

### Environment Variable Audit

```bash
# List environment variables for all environments
vercel env ls production
vercel env ls preview
vercel env ls development

# Check if sensitive information is exposed via NEXT_PUBLIC_ prefix
vercel env ls production 2>/dev/null | grep -iE 'NEXT_PUBLIC_.*(SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)'
```

**Patterns to detect**:
- Secret keys included in `NEXT_PUBLIC_` (`sk_`, `secret`, `password`)
- Same API keys used in Production and Preview (risk of accidental access to production DB)
- Sensitive variables without the `sensitive` flag set

### Deployment Inspection

```bash
# Check details of the latest deployment
vercel inspect $(vercel ls --json 2>/dev/null | jq -r '.[0].url') 2>/dev/null

# List deployments (check for unnecessary old deployments)
vercel ls --json 2>/dev/null | jq '.[] | {url, state, created}'
```

### Domains and Certificates

```bash
# List domains
vercel domains ls

# Check SSL certificates
vercel certs ls
```

### Static Analysis of vercel.json

```bash
# Check security headers in vercel.json
cat vercel.json 2>/dev/null | jq '.headers'

# public flag (exposes build logs and source)
cat vercel.json 2>/dev/null | jq '.public'
```

## Required Security Headers in vercel.json

Verify the following headers are configured:

| Header | Recommended | Risk |
|--------|-------------|------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HTTPS downgrade |
| `Content-Security-Policy` | `default-src 'self'` + required sources | XSS |
| `X-Frame-Options` | `DENY` | Clickjacking |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Information leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Browser feature abuse |

## Chrome MCP Dashboard Inspection

Dashboard-only settings that CLI cannot access. **Must run in main context** (not subagents).

### Prerequisites

1. Chrome is running and accessible by Chrome DevTools MCP
2. User is logged in to Vercel Dashboard
3. If not logged in, skip this section and note "Not Inspected — login required"

### URL Patterns

```
https://vercel.com/{team}/{project}/settings/deployment-protection
https://vercel.com/{team}/{project}/settings/security
https://vercel.com/{team}/{project}/firewall
https://vercel.com/{team}/{project}/settings/environment-variables
https://vercel.com/{team}/{project}/settings/domains
https://vercel.com/{team}/{project}/settings/functions
https://vercel.com/{team}/{project}/settings/git
```

### Step-by-Step Execution

#### 1. Deployment Protection

```
mcp__chrome-devtools__navigate_page(url: "https://vercel.com/{team}/{project}/settings/deployment-protection")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract accessibility tree for setting values
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Protection Scope | All Deployments | Dashboard → Deployment Protection → select "All Deployments" |
| Vercel Authentication | Enabled | Dashboard → Deployment Protection → toggle "Vercel Authentication" ON |
| Password Protection | Enabled for Preview | Dashboard → Deployment Protection → set password for Preview |
| Trusted IPs | Restricted to known IPs | Dashboard → Deployment Protection → add IP allowlist |

#### 2. Security Settings

```
mcp__chrome-devtools__navigate_page(url: "https://vercel.com/{team}/{project}/settings/security")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract setting values
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Attack Challenge Mode | Available | Dashboard → Security → verify toggle is accessible |
| Build Logs and Source Protection | Enabled | Dashboard → Security → toggle ON (hides `/_src`, `/_logs`) |
| Git Fork Protection | Enabled | Dashboard → Security → toggle ON (prevents env var leak from fork PRs) |
| Deployment Retention | Configured | Dashboard → Security → set appropriate retention period |

#### 3. Firewall (WAF)

```
mcp__chrome-devtools__navigate_page(url: "https://vercel.com/{team}/{project}/firewall")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract rule list
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Custom Rules | Rate limit on auth endpoints | Dashboard → Firewall → Add Rule → rate limit `/api/auth/*` |
| OWASP Managed Rulesets | Enabled | Dashboard → Firewall → Managed Rulesets → enable OWASP |
| IP Blocking | Block known malicious IPs | Dashboard → Firewall → IP Blocking → add rules |

#### 4. Git Settings

```
mcp__chrome-devtools__navigate_page(url: "https://vercel.com/{team}/{project}/settings/git")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract setting values
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Deploy Hooks | No unnecessary hooks exposed | Dashboard → Git → remove unused deploy hooks |
| Require Verified Commits | Enabled (GitHub only) | Dashboard → Git → toggle ON |

## Common Misconfigurations

| Severity | Misconfiguration | Impact |
|----------|------------------|--------|
| Critical | Secret keys in `NEXT_PUBLIC_` | Keys exposed in client JS |
| Critical | Production API keys in Preview | Access to production DB via Preview |
| High | Security headers not configured | XSS, clickjacking |
| High | Git Fork Protection disabled | Environment variable leakage from fork PRs |
| High | Build Logs/Source Protection disabled | Source code and build logs exposed publicly |
| Medium | No Deployment Protection for Preview | Unreleased features exposed externally |
| Medium | No Firewall rules | Auth endpoints exposed without rate limiting |
| Medium | Deploy Hook URL leaked | Third parties can trigger deployments |
| Low | Deployment Retention not configured | Old deployments remain unnecessarily |

## Automated Inspection via Vercel REST API

```bash
# List environment variables (via API)
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID" | \
  jq '.envs[] | {key, target, type}'

# Check Firewall configuration
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v1/security/firewall/config?projectId=$PROJECT_ID&teamId=$TEAM_ID"
```
