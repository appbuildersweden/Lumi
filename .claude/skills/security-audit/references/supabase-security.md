# Supabase Security Testing Reference

Backend configuration-level security testing guide for Supabase.
Combines items that can be retrieved via CLI/SQL with dashboard inspection via Chrome MCP.

## CLI-Based Automated Inspection

### Database Lint (Most Important)

```bash
# Run lint on the public schema
supabase db lint --linked --schema public

# Specify error level (for CI/CD)
supabase db lint --linked --fail-on warning
```

**Splinter Lint Rules (Security-Related)**:

| Code | Rule Name | Severity |
|------|-----------|----------|
| 0002 | Auth Users Exposed | Critical |
| 0006 | Multiple Permissive Policies | High |
| 0007 | Policy Exists RLS Disabled | Critical |
| 0008 | RLS Enabled No Policy | High |
| 0010 | Security Definer View | High |
| 0011 | Function Search Path Mutable | High |
| 0013 | RLS Disabled in Public | Critical |
| 0014 | Extension in Public | Medium |
| 0015 | RLS References user_metadata | High |

### SSL and Network Inspection

```bash
# Check SSL enforcement
supabase ssl-enforcement get --project-ref $PROJECT_REF

# Check network restrictions
supabase network-restrictions get --project-ref $PROJECT_REF

# Check IPs banned due to brute force
supabase network-bans get --project-ref $PROJECT_REF
```

### Edge Functions

```bash
# List functions
supabase functions list --project-ref $PROJECT_REF

# List secrets
supabase secrets list --project-ref $PROJECT_REF
```

## Detailed Inspection via SQL

### RLS Status Check (Most Important)

```sql
-- List of tables with RLS disabled (Critical)
SELECT n.nspname AS schema, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- RLS status for all tables
SELECT n.nspname AS schema, c.relname AS table_name,
  c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY c.relname;
```

### RLS Policy Inspection

```sql
-- Check policies per table
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
  qual AS using_expression, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Detect overly permissive policies (USING (true))
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual::text = 'true' OR with_check::text = 'true');

-- Tables with RLS enabled but no policies
SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relrowsecurity = true
  AND c.relname NOT IN (SELECT tablename FROM pg_policies WHERE schemaname = 'public');
```

### Function Security Inspection

```sql
-- Functions executable by the anon role
SELECT n.nspname, p.proname, p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- SECURITY DEFINER functions (privilege escalation risk)
SELECT n.nspname, p.proname, r.rolname AS owner,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.prosecdef = true
  AND n.nspname NOT IN ('pg_catalog', 'information_schema');
```

### Permission Inspection

```sql
-- Check anon/authenticated permissions
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;
```

### Storage Inspection

```sql
-- List buckets and their public status
SELECT id, name, public, created_at FROM storage.buckets ORDER BY name;

-- Storage policies
SELECT * FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname;
```

## Chrome MCP Dashboard Inspection

Dashboard-only settings that CLI/SQL cannot access. **Must run in main context** (not subagents).

### Prerequisites

1. Chrome is running and accessible by Chrome DevTools MCP
2. User is logged in to Supabase Dashboard
3. If not logged in, skip this section and note "Not Inspected — login required"

### URL Patterns

```
https://supabase.com/dashboard/project/{ref}/auth/providers
https://supabase.com/dashboard/project/{ref}/auth/url-configuration
https://supabase.com/dashboard/project/{ref}/auth/sessions
https://supabase.com/dashboard/project/{ref}/auth/rate-limits
https://supabase.com/dashboard/project/{ref}/auth/policies
https://supabase.com/dashboard/project/{ref}/settings/api
https://supabase.com/dashboard/project/{ref}/database/tables
https://supabase.com/dashboard/project/{ref}/database/security-advisor
https://supabase.com/dashboard/project/{ref}/storage/buckets
https://supabase.com/dashboard/project/{ref}/functions
```

### Step-by-Step Execution

#### 1. Auth Providers

```
mcp__chrome-devtools__navigate_page(url: "https://supabase.com/dashboard/project/{ref}/auth/providers")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract provider toggle states
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Email confirmation | Enabled | Dashboard → Auth → Providers → Email → toggle "Confirm email" ON |
| Unused OAuth providers | Disabled | Dashboard → Auth → Providers → disable unused providers |
| MFA (TOTP/Phone) | Enabled | Dashboard → Auth → MFA → enable TOTP or Phone factor |

#### 2. Session Settings

```
mcp__chrome-devtools__navigate_page(url: "https://supabase.com/dashboard/project/{ref}/auth/sessions")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract session config values
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Session expiry | Shorter than default (e.g., 1 hour) | Dashboard → Auth → Sessions → reduce JWT expiry |
| Inactivity timeout | Enabled | Dashboard → Auth → Sessions → set inactivity timeout |
| Refresh token reuse detection | Enabled | Dashboard → Auth → Sessions → toggle ON |

#### 3. Rate Limits

```
mcp__chrome-devtools__navigate_page(url: "https://supabase.com/dashboard/project/{ref}/auth/rate-limits")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract rate limit values
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Sign-up rate limit | Configured | Dashboard → Auth → Rate Limits → set sign-up limit |
| Sign-in rate limit | Configured | Dashboard → Auth → Rate Limits → set sign-in limit |
| Token refresh rate limit | Configured | Dashboard → Auth → Rate Limits → set token refresh limit |

#### 4. Security Advisor

```
mcp__chrome-devtools__navigate_page(url: "https://supabase.com/dashboard/project/{ref}/database/security-advisor")
mcp__chrome-devtools__take_screenshot()  → capture all findings
mcp__chrome-devtools__take_snapshot()    → extract finding details via accessibility tree
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| Critical findings | 0 items | Fix each Critical finding per Security Advisor guidance |
| High findings | 0 items | Fix each High finding per Security Advisor guidance |
| Lint warnings | Reviewed | Review and resolve or document accepted risks |

#### 5. API Settings

```
mcp__chrome-devtools__navigate_page(url: "https://supabase.com/dashboard/project/{ref}/settings/api")
mcp__chrome-devtools__take_screenshot()  → capture evidence
mcp__chrome-devtools__take_snapshot()    → extract API config
```

**Checks**:
| Setting | Recommended | Remediation if Missing |
|---------|-------------|----------------------|
| service_role key exposure | Not in client code | Verify via Grep (see static analysis section) |
| Data API | Disabled if not needed | Dashboard → Settings → API → toggle Data API OFF |
| JWT secret rotation | Rotated periodically | Dashboard → Settings → API → rotate JWT secret |

## Common Misconfigurations

| Severity | Misconfiguration | Impact |
|----------|------------------|--------|
| Critical | RLS disabled on public tables | All data readable/writable with anon key |
| Critical | service_role key exposed in client | Completely bypasses RLS |
| Critical | SSRF via http extension | Arbitrary URL fetching possible |
| High | RLS policy with `USING (true)` | All rows accessible |
| High | Email confirmation disabled | Sign-in possible with unverified email |
| High | Misuse of SECURITY DEFINER functions | Privilege escalation |
| High | RLS references user_metadata | Authorization based on user-modifiable values |
| Medium | Missing Storage bucket policies | All files publicly accessible |
| Medium | Realtime without filters | Unnecessary data leakage |
| Medium | Extensions installed in public schema | Increased attack surface |
| Low | Custom SMTP not configured | 30 users/hour limit, poor deliverability |

## Static Analysis of Codebase

```bash
# Detect service_role key exposure in client code
grep -rn --include='*.{ts,tsx,js,jsx}' \
  -E '(service_role|SUPABASE_SERVICE_ROLE|supabaseServiceRole)' . | \
  grep -v 'node_modules' | grep -v '.env'

# Hardcoded anon key
grep -rn --include='*.{ts,tsx,js,jsx}' \
  -E 'eyJ[A-Za-z0-9_-]{20,}' . | grep -v 'node_modules'

# createClient using service_role in supabase-js
grep -rn --include='*.{ts,tsx,js,jsx}' \
  -E 'createClient.*service_role' .
```
