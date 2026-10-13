---
name: security-audit
description: Full-stack security audit for Web, Mobile, Backend, IaC, Compliance, LLM/AI. OWASP Top 10:2025, MASVS v2, CIS Benchmarks, PCI-DSS, GDPR. CLI + Chrome MCP. Triggered by "security audit", "vulnerability scan", "pentest".
effort: max
---

# Security Audit

Full-stack vulnerability assessment skill covering Application, Infrastructure, Backend, Mobile, Compliance, and Advanced Detection.
Combines codebase static analysis, CLI/SQL configuration checks, and Chrome MCP dashboard inspection to audit all layers end-to-end.

## When NOT to Use This Skill

- **Runtime testing**: This skill performs static analysis only. Use DAST tools (ZAP, Burp Suite) for runtime testing.
- **Penetration testing execution**: This skill identifies vulnerabilities but does not exploit them.
- **Compliance certification**: Findings inform compliance but do not constitute a formal audit.
- **Non-security code review**: Use `code-reviewer` agent for general code quality.

## Rationalizations to Reject

When evaluating findings, reject these false-positive rationalizations:

- "It's behind authentication" — Authenticated users can still be attackers
- "We'll fix it later" — Security debt compounds; Critical/High must be fixed now
- "It's only in dev/staging" — Credentials and patterns often leak to production
- "The framework handles it" — Verify the framework actually covers this specific case
- "No one would find this" — Security through obscurity is not a defense

## Design Principles

- **Evidence-First**: Findings backed by code evidence, not speculation
- **Full-Stack Coverage**: Application -> Infrastructure -> Backend -> Mobile -> Compliance -> Advanced
- **Progressive Disclosure**: Scan high-risk areas first, drill down incrementally
- **CLI + Chrome MCP**: Automate what CLI/API can reach; use Chrome MCP for dashboard-only settings

## Prerequisites

### Chrome MCP Dashboard Inspection

Chrome MCP inspection requires a browser with active login sessions. Before running targets that include dashboard checks (`vercel`, `supabase`, `web`, `all`):

1. Ensure Chrome is running and accessible by Chrome DevTools MCP
2. Log in to the relevant dashboards:
   - **Vercel**: `https://vercel.com/dashboard`
   - **Supabase**: `https://supabase.com/dashboard`
3. If not logged in, the audit will **skip dashboard checks** and note them as "Not Inspected — login required" in the report

If Chrome MCP is unavailable, the audit proceeds with CLI/code-only checks and flags skipped dashboard items.

## Execution Model

The audit runs in two stages to work around subagent tool limitations:

### Stage 1: Static Analysis (Parallelizable via Subagents)

Phases 1-8 code/config checks use **Grep, Glob, Bash, Read** — tools available to all agent types. These can be parallelized across multiple subagents:

```
[Main Context] Orchestrator
  ├── [Subagent A] Web Application Audit (Grep, Bash)
  ├── [Subagent B] Backend Audit (Grep, Bash)
  ├── [Subagent C] Mobile Audit (Grep, Bash)
  ├── [Subagent D] IaC / Compliance / Advanced (Grep, Bash)
  └── [Main Context] Cross-Layer Analysis (synthesize subagent results)
```

### Stage 2: Dashboard Inspection (Main Context Only)

Chrome MCP tools (`mcp__chrome-devtools__*`) are **only available in the main context**, not in subagents. Dashboard inspection MUST run in the main orchestrator:

```
[Main Context] Chrome MCP Inspection
  ├── Navigate to Vercel Dashboard → take_screenshot → inspect settings
  ├── Navigate to Supabase Dashboard → take_screenshot → inspect settings
  └── Compile dashboard findings with manual remediation steps
```

**Important**: Never delegate Chrome MCP checks to subagents — they will silently skip them. The main orchestrator must execute all `mcp__chrome-devtools__*` calls directly.

## Execution Rules

### Report Generation

When findings exceed **10 items** or span **3+ layers**, pause and ask the user:

> "Found X findings (Critical: N / High: N / Medium: N / Low: N). Would you like to generate a report file?"

- **Yes**: Generate `security-audit-report-YYYY-MM-DD.md` in the project root
- **No**: Continue with inline summary only

### Chrome MCP Dashboard Findings

Dashboard settings found via Chrome MCP **cannot be fixed by CLI or code changes**. For each dashboard finding, include:

1. **Current Value**: The current state observed via Chrome MCP
2. **Recommended Value**: The security-recommended setting
3. **Manual Remediation Steps**: Step-by-step instructions to change the setting in the dashboard (screen path + actions)
4. **Impact**: Side effects of the change on existing functionality

Example format in report:

```markdown
### [HIGH-003] Vercel Deployment Protection Disabled
- **Current Value**: Deployment Protection = OFF
- **Recommended Value**: Deployment Protection = Vercel Authentication
- **Manual Remediation Steps**:
  1. Vercel Dashboard → Project Settings → Deployment Protection
  2. Select "Standard Protection"
  3. Enable "Vercel Authentication"
  4. Verify protection level for Preview Deployments
  5. Click "Save"
- **Impact**: Public access to Preview URLs will be restricted. Sharing with external stakeholders requires configuring Shareable Links.
```

## Target Selection

```
/security-audit              -> Interactive target selection
/security-audit all          -> Full-stack end-to-end audit (recommended)
/security-audit nextjs       -> Next.js application only
/security-audit vercel       -> Vercel infrastructure only
/security-audit supabase     -> Supabase backend only
/security-audit ios          -> iOS app only
/security-audit android      -> Android app only
/security-audit flutter      -> Flutter app only
/security-audit react-native -> React Native app only
/security-audit mobile       -> All mobile platforms (iOS + Android + Flutter + RN)
/security-audit web          -> Next.js + Vercel + Supabase (full web stack)
/security-audit python       -> Python (Django/FastAPI/Flask)
/security-audit go           -> Go
/security-audit rails        -> Ruby on Rails
/security-audit rust         -> Rust
/security-audit backend      -> All backend frameworks
/security-audit terraform    -> Terraform IaC
/security-audit aws          -> AWS infrastructure
/security-audit gcp          -> GCP infrastructure
/security-audit azure        -> Azure infrastructure
/security-audit iac          -> All IaC (Terraform + AWS + GCP + Azure)
/security-audit compliance   -> PCI-DSS, HIPAA, SOX, GDPR, CCPA, SOC2, ISO27001
/security-audit supply-chain -> Supply chain and dependency security
/security-audit container    -> Container and Kubernetes security
/security-audit cicd         -> CI/CD pipeline security
/security-audit secrets      -> Secret scanning (git history + code)
/security-audit llm          -> LLM/AI security (OWASP Top 10 for LLM)
/security-audit advanced     -> All advanced detection
```

## Phase 1: Reconnaissance

Understand the target codebase structure.

1. Project composition (framework, language, dependencies, versions)
2. Entry point enumeration (API Routes, Server Actions, URL schemes)
3. Trust boundary identification (user input -> app -> backend -> mobile)
4. Authentication/authorization flow mapping
5. Data flow visualization (sensitive data lifecycle)

## Phase 2: Web Application Audit

### Next.js — See `references/nextjs-security.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | Server Actions auth/authz/validation | Grep |
| Critical | Next.js version CVE assessment | Bash |
| Critical | `NEXT_PUBLIC_` secret exposure | Grep |
| High | Middleware bypass resistance | Grep |
| High | Image optimization SSRF (remotePatterns) | Grep |
| High | CSP and security headers | Grep |
| Medium | Server/Client Component data leakage | Grep |

### General Web — See `references/web-testing.md`

## Phase 3: Infrastructure Audit

### Vercel — See `references/vercel-security.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | Environment variable secret exposure | CLI |
| High | Deployment Protection settings | Chrome MCP |
| High | Git Fork Protection | Chrome MCP |
| Medium | Firewall / WAF rules | Chrome MCP |

### Supabase — See `references/supabase-security.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | RLS enabled on all public tables | SQL |
| Critical | service_role key client exposure | Grep |
| Critical | Overly permissive RLS policies | SQL |
| High | SECURITY DEFINER functions | SQL |
| High | Auth settings (MFA, email confirm) | Chrome MCP |

### Terraform — See `references/terraform-security.md`
### AWS — See `references/aws-security.md`
### GCP — See `references/gcp-security.md`
### Azure — See `references/azure-security.md`

## Phase 4: Backend Audit

### Python (Django/FastAPI/Flask) — See `references/python-security.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | SQL Injection (raw queries, ORM misuse) | Grep |
| Critical | Command Injection detection | Grep |
| Critical | Insecure deserialization detection | Grep |
| High | Django DEBUG/SECRET_KEY/ALLOWED_HOSTS | Grep |
| High | SSTI (template injection) | Grep |
| Medium | CSRF configuration | Grep |

### Go — See `references/go-security.md`
### Ruby on Rails — See `references/rails-security.md`
### Rust — See `references/rust-security.md`

## Phase 5: Mobile Audit

### iOS — See `references/ios-testing.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | Keychain access attributes | Grep |
| Critical | ATS config and Certificate Pinning | Grep + Bash |
| Critical | Biometric authentication | Grep |
| High | NSUserDefaults sensitive data | Grep |
| High | WebView security | Grep |

### Android — See `references/android-security.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | SharedPreferences sensitive data | Grep |
| Critical | Network Security Config | Grep |
| Critical | Exported components | Grep |
| High | WebView JavaScript enabled | Grep |
| High | Root/emulator detection | Grep |

### Flutter — See `references/flutter-security.md`
### React Native — See `references/react-native-security.md`

## Phase 6: Compliance Audit

### Financial (PCI-DSS/HIPAA/SOX) — See `references/compliance-financial.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | PAN/credit card data in code | Grep |
| Critical | PHI field exposure | Grep |
| High | Encryption at rest/in transit | Grep |
| High | Audit logging implementation | Grep |
| Medium | Access control / RBAC | Grep |

### Privacy (GDPR/CCPA/SOC2/ISO27001) — See `references/compliance-privacy.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | PII field identification | Grep |
| Critical | Consent management | Grep |
| High | Data retention policies | Grep |
| High | Right to erasure implementation | Grep |
| Medium | Data classification | Grep |

## Phase 7: Advanced Detection

### Supply Chain — See `references/supply-chain-security.md`
### Container and Kubernetes — See `references/container-security.md`
### CI/CD Pipeline — See `references/cicd-security.md`
### Secret Scanning — See `references/secret-scanning.md`
### LLM/AI Security — See `references/llm-security.md`

| Priority | Check | Method |
|----------|-------|--------|
| Critical | Hardcoded secrets in code/history | Grep + Bash |
| Critical | Prompt injection vulnerabilities | Grep |
| Critical | Container running as root | Grep |
| High | GitHub Actions unpinned actions | Grep |
| High | Dependency confusion risk | Grep + Bash |
| High | Kubernetes RBAC misconfig | Grep |
| Medium | SBOM generation | Bash |

## Phase 8: Cross-Layer Analysis

Evaluate threats that span multiple layers.

- **Auth flow consistency**: Backend Auth -> JWT -> Middleware -> Mobile Keychain
- **Token lifecycle**: Issuance -> Storage -> Refresh -> Revocation (all stages)
- **API communication security**: Certificate Pinning x Edge x Backend API
- **Environment variable isolation**: Production/Preview/Development x API keys
- **Data protection continuity**: Backend RLS -> API response -> Mobile local storage
- **Supply chain consistency**: Lock file integrity across all package managers
- **Secret hygiene**: No secrets in code, config, CI/CD, container layers, or git history

## Report Format

```markdown
# Full-Stack Security Audit Report
**Target**: [project name]
**Date**: [YYYY-MM-DD]
**Scope**: [selected targets]

## Executive Summary
- Critical: X / High: Y / Medium: Z / Low: W
- Top priority: [one-line summary]

## Layer Summary
| Layer        | Critical | High | Medium | Low |
|--------------|----------|------|--------|-----|
| Web App      | X | X | X | X |
| Infrastructure | X | X | X | X |
| Backend      | X | X | X | X |
| Mobile       | X | X | X | X |
| Compliance   | X | X | X | X |
| Advanced     | X | X | X | X |
| Cross-Layer  | X | X | X | X |

## Findings

### Code/Config Findings
### [CRITICAL-001] [vulnerability title]
- **Layer**: [Web / Infrastructure / Backend / Mobile / Compliance / Advanced / Cross-layer]
- **Category**: OWASP [A01/MASVS-STORAGE/CIS/PCI-DSS/etc.]
- **Location**: `file_path:line_number`
- **Description**: What the vulnerability is
- **Impact**: What happens if exploited
- **Remediation**: diff-format code fix

### Dashboard Findings (Manual Remediation Required)
### [HIGH-XXX] [dashboard setting title]
- **Layer**: [Vercel / Supabase / AWS Console / GCP Console / Azure Portal]
- **Category**: [Configuration / Access Control / Encryption / etc.]
- **Current Value**: [value observed via Chrome MCP]
- **Recommended Value**: [security-recommended value]
- **Manual Remediation Steps**:
  1. [Dashboard URL / screen path]
  2. [Specific action steps]
  3. [Save / apply instructions]
- **Impact**: [Side effects on existing functionality]

## Remediation Roadmap
| Priority | Action | Layer | Type |
|----------|--------|-------|------|
| Immediate | Fix Critical vulnerabilities | - | Code |
| Immediate | Fix Critical dashboard settings | - | Manual |
| Short-term | Fix High vulnerabilities | - | Code |
| Short-term | Fix High dashboard settings | - | Manual |
| Mid-term | Architecture improvements | - | Code |
```

## Tools and Agents

| Tool | Purpose |
|------|---------|
| **Grep/Glob** | Static pattern detection in code |
| **Bash** | CLI commands (npm audit, pip-audit, cargo-audit, etc.) |
| **Bash (SQL)** | Direct Supabase DB queries (RLS status, etc.) |
| **Bash (Cloud CLI)** | AWS CLI, gcloud, az commands for infrastructure audit |
| **Chrome MCP** | Vercel/Supabase dashboard settings inspection |
| **security-reviewer** agent | OWASP Top 10 code review |
| **security** role | Threat modeling, CVE correlation |
| **WebSearch** | Latest CVE/advisory lookup |
