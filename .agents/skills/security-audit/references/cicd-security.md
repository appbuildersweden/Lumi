# CI/CD Pipeline Security Reference

A security inspection guide for CI/CD pipelines. Covers GitHub Actions, GitLab CI, and Vercel.

## GitHub Actions: Third-Party Action Pinning

### Risk

Actions specified by tag (`v1`, `latest`) allow the author to move the tag and execute arbitrary code. SHA pinning is required.

### Inspection Patterns

```bash
# Detect Actions not pinned by SHA
grep -rn --include='*.yml' --include='*.yaml' \
  'uses:' .github/workflows/ 2>/dev/null | \
  grep -v -E '(@[a-f0-9]{40}|actions/checkout|actions/setup-node)' | \
  grep -v '#'

# Actions specified by tag only
grep -rn --include='*.yml' --include='*.yaml' \
  -E 'uses: [^@]+@v[0-9]' .github/workflows/ 2>/dev/null

# SHA-pinned Actions (Good)
grep -rn --include='*.yml' --include='*.yaml' \
  -E 'uses: .+@[a-f0-9]{40}' .github/workflows/ 2>/dev/null | head -10
```

## GITHUB_TOKEN Permissions

### Risk

If the default permissions for `GITHUB_TOKEN` are `write-all`, a compromised job can tamper with the repository.

```bash
# Check permissions settings
grep -rn --include='*.yml' --include='*.yaml' \
  -B 2 -A 10 'permissions:' .github/workflows/ 2>/dev/null

# Workflows without permissions defined
for f in $(find .github/workflows -name '*.yml' -o -name '*.yaml' 2>/dev/null); do
  if ! grep -q 'permissions:' "$f"; then
    echo "NO PERMISSIONS DEFINED: $f"
  fi
done

# Detect write-all
grep -rn --include='*.yml' --include='*.yaml' \
  'permissions: write-all' .github/workflows/ 2>/dev/null
```

## Workflow Injection

### Risk

When user input is directly expanded in `${{ }}` expressions, arbitrary commands can be executed. PR titles, issue bodies, and commit messages are attack vectors.

### Inspection Patterns

```bash
# Direct use of dangerous expressions (Critical)
grep -rn --include='*.yml' --include='*.yaml' \
  -E '\$\{\{.*github\.(event\.(issue|pull_request|comment)\.(title|body|name)|head_ref)' \
  .github/workflows/ 2>/dev/null

# Usage of ${{ }} within run: (injection risk)
grep -rn --include='*.yml' --include='*.yaml' \
  -B 1 -A 1 'run:.*\$\{\{' .github/workflows/ 2>/dev/null

# Usage of pull_request_target (high risk)
grep -rn --include='*.yml' --include='*.yaml' \
  'pull_request_target' .github/workflows/ 2>/dev/null

# Usage of workflow_run (privilege escalation risk)
grep -rn --include='*.yml' --include='*.yaml' \
  'workflow_run' .github/workflows/ 2>/dev/null
```

**Examples of Dangerous Expressions**:

| Expression | Attack Vector |
|-----------|---------------|
| `${{ github.event.issue.title }}` | Command injection via issue title |
| `${{ github.event.pull_request.body }}` | Command injection via PR body |
| `${{ github.event.comment.body }}` | Command injection via comment |
| `${{ github.head_ref }}` | Command injection via branch name |
| `${{ github.event.pages.*.page_name }}` | Command injection via wiki page name |

**Mitigation**: Pass values through environment variables instead of direct expansion.

```yaml
# BAD
- run: echo "${{ github.event.issue.title }}"

# GOOD
- run: echo "$TITLE"
  env:
    TITLE: ${{ github.event.issue.title }}
```

## Secret Exposure

```bash
# Check locations where secrets are used
grep -rn --include='*.yml' --include='*.yaml' \
  'secrets\.' .github/workflows/ 2>/dev/null

# Secrets output via echo/printf (leakage risk)
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(echo|printf).*\$\{\{.*secrets\.' .github/workflows/ 2>/dev/null

# Secrets set as environment variables
grep -rn --include='*.yml' --include='*.yaml' \
  -A 3 'env:' .github/workflows/ 2>/dev/null | \
  grep 'secrets\.' | head -20

# Writing secrets to $GITHUB_ENV (exposed to all subsequent steps)
grep -rn --include='*.yml' --include='*.yaml' \
  'GITHUB_ENV.*secrets\|secrets.*GITHUB_ENV' .github/workflows/ 2>/dev/null
```

## Artifact Security

```bash
# Usage of upload-artifact / download-artifact
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(upload-artifact|download-artifact)' .github/workflows/ 2>/dev/null

# Check retention-days settings
grep -rn --include='*.yml' --include='*.yaml' \
  'retention-days' .github/workflows/ 2>/dev/null

# Artifacts that may contain sensitive data
grep -rn --include='*.yml' --include='*.yaml' \
  -A 5 'upload-artifact' .github/workflows/ 2>/dev/null | \
  grep -iE '(\.env|secret|credential|key|token|log)'
```

## Environment Protection

```bash
# Check for environment usage
grep -rn --include='*.yml' --include='*.yaml' \
  'environment:' .github/workflows/ 2>/dev/null

# Unprotected production deployments
grep -rn --include='*.yml' --include='*.yaml' \
  -B 5 -A 5 'environment.*prod' .github/workflows/ 2>/dev/null
```

## OIDC (Workload Identity Federation)

### Risk

Instead of long-lived credentials (e.g., AWS Access Keys), short-lived authentication via OIDC tokens should be used.

```bash
# Check for OIDC usage
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(id-token: write|aws-actions/configure-aws-credentials|google-github-actions/auth)' \
  .github/workflows/ 2>/dev/null

# Usage of long-lived credentials (OIDC migration recommended)
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_CREDENTIALS)' \
  .github/workflows/ 2>/dev/null
```

## Build Security

```bash
# Secret exposure during builds
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(build-args|--build-arg).*secrets\.' .github/workflows/ 2>/dev/null

# Cache poisoning risk
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(actions/cache|cache:)' .github/workflows/ 2>/dev/null

# Check if cache keys contain user input
grep -rn --include='*.yml' --include='*.yaml' \
  -A 5 'actions/cache' .github/workflows/ 2>/dev/null | \
  grep -E 'key:.*\$\{\{ github\.(event|head_ref)'
```

## Branch Protection

```bash
# Check branch protection settings (gh CLI)
# gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null

# Check for existence of CODEOWNERS
ls -la .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS 2>/dev/null

# Check for signed commits settings
grep -rn --include='*.yml' --include='*.yaml' \
  'commit-signature' .github/ 2>/dev/null
```

## GitLab CI Security

```bash
# Check for existence of .gitlab-ci.yml
cat .gitlab-ci.yml 2>/dev/null | head -50

# Unprotected variables
grep -rn 'variables:' .gitlab-ci.yml 2>/dev/null

# Dangerous script execution
grep -rn --include='.gitlab-ci.yml' \
  -E '(curl.*\| bash|wget.*\| sh|eval )' . 2>/dev/null

# Check Runner configuration
grep -rn 'tags:' .gitlab-ci.yml 2>/dev/null

# External CI configuration imports via include
grep -rn 'include:' .gitlab-ci.yml 2>/dev/null
```

## Vercel Security

```bash
# Check vercel.json
cat vercel.json 2>/dev/null

# Check build commands
grep -E '(buildCommand|installCommand|devCommand)' vercel.json 2>/dev/null

# Check environment variable settings
grep -E '(env|environment)' vercel.json 2>/dev/null

# Check header settings
grep -A 10 '"headers"' vercel.json 2>/dev/null

# Check access control for Vercel preview deployments
grep -E '(password|protection|authentication)' vercel.json 2>/dev/null
```

## Common Misconfigurations

| Severity | Misconfiguration | Impact |
|----------|-----------------|--------|
| Critical | `pull_request_target` with `actions/checkout` + PR code execution | Repository secret leakage |
| Critical | User input directly expanded in `${{ }}` expressions | Arbitrary command execution |
| Critical | Secrets output via echo | Secret leakage to logs |
| High | Actions not pinned by SHA | Supply chain attack |
| High | GITHUB_TOKEN set to write-all | Repository tampering |
| High | Usage of long-lived credentials (OIDC not adopted) | High impact upon credential leakage |
| High | No Environment protection configured | Unauthorized deployments |
| Medium | Sensitive data in artifacts | Accessible in public repositories |
| Medium | User input in cache keys | Cache poisoning |
| Low | retention-days not set | Unnecessary artifact retention |

## CI/CD Security Checklist

- [ ] All third-party Actions are pinned by SHA
- [ ] `permissions:` is set to least privilege at workflow or job level
- [ ] User input is not directly expanded in `${{ }}` expressions
- [ ] `pull_request_target` is used safely (avoiding checkout of PR code)
- [ ] Secrets are not output via `echo` / `printf`
- [ ] Secrets are not written to `$GITHUB_ENV`
- [ ] Environment protection (required reviewers) is configured for production deployments
- [ ] OIDC is used and long-lived credentials are eliminated
- [ ] Branch protection (required reviews, status checks) is enabled
- [ ] CODEOWNERS is configured
- [ ] Artifacts do not contain sensitive data
- [ ] `curl | bash` pattern is not used
- [ ] Access control is configured for Vercel preview deployments
- [ ] GitLab CI variables are set to protected / masked
