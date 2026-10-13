# Secret Scanning Reference

A guide for detecting secret leaks in Git history, build artifacts, and configuration files.

## Git History Scanning

### Risk

Secrets contained in past commits can be recovered via `git log` or `git show`. Even if a file is deleted, it does not disappear from Git history.

### Inspection Patterns

```bash
# Scan with gitleaks
gitleaks detect --source . --verbose 2>/dev/null | head -50

# Scan with trufflehog
trufflehog git file://. --only-verified 2>/dev/null | head -50

# Check if git-secrets is installed
git secrets --scan 2>/dev/null

# Detect secrets in recent commits
git log --diff-filter=A --name-only --pretty=format: -10 2>/dev/null | \
  grep -iE '\.(env|pem|key|p12|pfx|jks|keystore|credentials)$'

# Check if .git/config contains credentials
grep -iE '(password|token|secret)' .git/config 2>/dev/null
```

## Common Secret Patterns

### AWS

```bash
# AWS Access Key ID (20 characters starting with AKIA)
grep -rn -E 'AKIA[0-9A-Z]{16}' . --include='*.{ts,js,py,rb,go,java,yml,yaml,json,env,cfg,conf,toml}' \
  2>/dev/null | grep -v node_modules

# AWS Secret Access Key
grep -rn -E '['\''"][0-9a-zA-Z/+]{40}['\''"]' . \
  --include='*.{ts,js,py,rb,go,java,env}' 2>/dev/null | \
  grep -iE '(secret|aws)' | grep -v node_modules
```

### API Tokens & Keys

```bash
# GitHub Token (ghp_, gho_, ghs_, ghr_, github_pat_)
grep -rn -E '(ghp_[0-9a-zA-Z]{36}|gho_[0-9a-zA-Z]{36}|ghs_[0-9a-zA-Z]{36}|ghr_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})' \
  . 2>/dev/null | grep -v node_modules

# Slack Token (xoxb-, xoxp-, xoxs-, xoxa-)
grep -rn -E 'xox[bpsa]-[0-9]{10,13}-[0-9a-zA-Z-]{20,}' \
  . 2>/dev/null | grep -v node_modules

# OpenAI API Key (sk-)
grep -rn -E 'sk-[0-9a-zA-Z]{20,}' . 2>/dev/null | grep -v node_modules

# Anthropic API Key (sk-ant-)
grep -rn -E 'sk-ant-[0-9a-zA-Z-]{20,}' . 2>/dev/null | grep -v node_modules

# Stripe Key (sk_live_, pk_live_)
grep -rn -E '(sk_live_|pk_live_|rk_live_)[0-9a-zA-Z]{20,}' \
  . 2>/dev/null | grep -v node_modules

# Google API Key
grep -rn -E 'AIza[0-9A-Za-z\\-_]{35}' . 2>/dev/null | grep -v node_modules

# SendGrid API Key
grep -rn -E 'SG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}' \
  . 2>/dev/null | grep -v node_modules

# Twilio Account SID / Auth Token
grep -rn -E 'AC[a-z0-9]{32}' . 2>/dev/null | grep -v node_modules
```

### Private Keys & Certificates

```bash
# RSA / EC / SSH private keys
grep -rn -E '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' \
  . 2>/dev/null | grep -v node_modules

# Detect .pem / .key files
find . -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \
  -o -name '*.jks' 2>/dev/null | grep -v node_modules

# SSH key files
find . -name 'id_rsa' -o -name 'id_ed25519' -o -name 'id_ecdsa' \
  2>/dev/null | grep -v node_modules
```

### Database Connection Strings

```bash
# Check if connection strings contain passwords
grep -rn -E '(postgres|mysql|mongodb|redis|amqp)://[^:]+:[^@]+@' \
  . 2>/dev/null | grep -v node_modules

# Check if DATABASE_URL contains a password
grep -rn 'DATABASE_URL' . 2>/dev/null | \
  grep -E '://[^:]+:[^@]+@' | grep -v node_modules
```

### Generic Patterns

```bash
# Hardcoded password / secret / token
grep -rn --include='*.{ts,js,py,rb,go,java}' \
  -iE '(password|secret|token|api_key|apikey|api-key)\s*[:=]\s*['\''"][^'\''"{$]+['\''"]' \
  . 2>/dev/null | grep -v node_modules | grep -v -E '(test|spec|mock|example|placeholder)'

# Hardcoded JWT tokens
grep -rn -E 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' \
  . 2>/dev/null | grep -v node_modules
```

## Build Artifacts

### Risk

Secrets may be contained in Docker layers, source maps, and compiled assets.

```bash
# Detect secrets in Docker layers
# docker history <image> --no-trunc 2>/dev/null | grep -iE '(secret|password|token|key)'

# Check for existence of source maps (may contain secrets)
find . -name '*.map' -path '*/dist/*' -o -name '*.map' -path '*/build/*' \
  2>/dev/null | head -10

# Check if source maps are exposed in production
grep -rn 'productionBrowserSourceMaps\|sourcemap\|source-map' \
  next.config.* webpack.config.* vite.config.* 2>/dev/null

# Check if .env is included in build output
find dist build out .next -name '.env*' 2>/dev/null
```

## Environment Files

### Risk

If `.env` files are committed to Git or placed in public directories, all secrets are leaked.

```bash
# List .env files
find . -name '.env*' -not -path '*/node_modules/*' 2>/dev/null

# Check if .env files are tracked by Git (Critical)
git ls-files | grep -E '\.env'

# Check if .env is included in .gitignore
grep -E '\.env' .gitignore 2>/dev/null

# List secrets in .env files
for f in $(find . -name '.env*' -not -path '*/node_modules/*' 2>/dev/null); do
  echo "=== $f ==="
  grep -iE '(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE)' "$f" 2>/dev/null | \
    sed 's/=.*/=***REDACTED***/'
done

# Check if .env.example contains default values
grep -E '=.{8,}' .env.example .env.sample 2>/dev/null | \
  grep -v -E '(your-|example|placeholder|changeme|xxx)'
```

## Pre-commit Hooks

```bash
# Check pre-commit configuration
cat .pre-commit-config.yaml 2>/dev/null | \
  grep -A 5 -E '(detect-secrets|gitleaks|trufflehog|git-secrets)'

# Check husky / lint-staged configuration
cat .husky/pre-commit 2>/dev/null
grep -A 5 'lint-staged' package.json 2>/dev/null

# Check git-secrets configuration
git config --get-all secrets.patterns 2>/dev/null
git config --get-all secrets.allowed 2>/dev/null
```

### Recommended pre-commit Configuration

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

## Secret Rotation

### Response Procedure for Leaks

1. **Immediately revoke**: Rotate the leaked secret immediately
2. **Assess impact scope**: Identify the scope of the leak with `git log -p --all -S 'LEAKED_SECRET'`
3. **Remove from Git history**: Use `git filter-repo` or BFG Repo-Cleaner
4. **Update all environments**: Update CI/CD, deployment targets, and team member environments

```bash
# Search Git history for leaked secrets
git log -p --all -S 'AKIA' 2>/dev/null | head -30

# Removal with BFG (backup required before execution)
# bfg --replace-text passwords.txt .

# Removal with git filter-repo
# git filter-repo --invert-paths --path secrets.txt
```

## Secret Manager Integration

```bash
# Check for usage of AWS Secrets Manager
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(SecretsManager|secretsmanager|GetSecretValue)' . 2>/dev/null | \
  grep -v node_modules

# Check for usage of HashiCorp Vault
grep -rn --include='*.{ts,js,py,rb,go,yml,yaml}' \
  -E '(vault\.|hashicorp|VAULT_ADDR|VAULT_TOKEN)' . 2>/dev/null | \
  grep -v node_modules

# Check for usage of 1Password CLI / Connect
grep -rn --include='*.{ts,js,py,yml,yaml}' \
  -E '(1password|op://|OP_CONNECT|onepassword)' . 2>/dev/null

# Check for usage of Google Secret Manager
grep -rn --include='*.{ts,js,py,go}' \
  -E '(secretmanager|SecretManagerServiceClient|google.*secret)' . 2>/dev/null | \
  grep -v node_modules

# Check for usage of Azure Key Vault
grep -rn --include='*.{ts,js,py,go}' \
  -E '(KeyVaultClient|SecretClient|azure.*keyvault)' . 2>/dev/null | \
  grep -v node_modules
```

## gitleaks / trufflehog Configuration

### gitleaks Configuration Example

```bash
# Check for existence of .gitleaks.toml
cat .gitleaks.toml 2>/dev/null

# Recommended gitleaks configuration checks
grep -E '(allowlist|rules|path)' .gitleaks.toml 2>/dev/null
```

### Secret Pattern Reference

| Pattern Name | Regex | Example |
|-------------|-------|---------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` | `AKIAIOSFODNN7EXAMPLE` |
| GitHub Token | `ghp_[0-9a-zA-Z]{36}` | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| Slack Token | `xox[bpsa]-[0-9]{10,}` | `xoxb-1234567890-abcdef` |
| OpenAI Key | `sk-[0-9a-zA-Z]{20,}` | `sk-xxxxxxxxxxxxxxxxxxxxxxxx` |
| Anthropic Key | `sk-ant-[0-9a-zA-Z-]{20,}` | `sk-ant-api03-xxxx` |
| Stripe Live Key | `sk_live_[0-9a-zA-Z]{20,}` | `sk_live_xxxxxxxxxxxx` |
| RSA Private Key | `-----BEGIN RSA PRIVATE KEY-----` | PEM format |
| Connection String | `(postgres\|mysql)://.*:.*@` | `postgres://user:pass@host` |
| JWT | `eyJ[A-Za-z0-9_-]{10,}\.eyJ` | `eyJhbGciOiJIUzI1NiJ9.eyJ...` |
| Google API Key | `AIza[0-9A-Za-z\\-_]{35}` | `AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx` |
| SendGrid Key | `SG\.[0-9A-Za-z\-_]{22}\.` | `SG.xxxxxx.yyyyyyy` |

## Common Leak Patterns

| Severity | Pattern | Impact |
|----------|---------|--------|
| Critical | AWS Access Key committed to Git | AWS account takeover |
| Critical | Private key (.pem, id_rsa) present in repository | Unauthorized server access |
| Critical | `.env.production` tracked by Git | Leakage of all production secrets |
| High | API keys hardcoded in source code | Unauthorized use of services |
| High | DB connection string with plaintext password | Unauthorized database access |
| High | Secrets remaining in Docker layers | Secret extraction from containers |
| Medium | Default secret values in .env.example | Guessable credentials |
| Medium | Source maps exposed in production | Source code leakage |
| Low | Unclear mock secrets in test code | Confusion with production secrets |

## Secret Scanning Checklist

- [ ] gitleaks or trufflehog is executed in CI/CD
- [ ] Pre-commit hooks with secret detection are enabled
- [ ] `.env` files are included in `.gitignore`
- [ ] `.env` files are not tracked by Git (verified with `git ls-files`)
- [ ] AWS Access Keys are not present in source code
- [ ] API tokens and keys are not hardcoded
- [ ] Private key files (.pem, .key) are not included in the repository
- [ ] DB connection strings are managed via environment variables
- [ ] Secrets are not baked into Docker images
- [ ] Source maps are disabled in the production environment
- [ ] A Secret Manager (Vault, AWS SM, 1Password, etc.) is integrated
- [ ] Secret rotation procedures are documented
- [ ] `.env.example` contains only placeholders
