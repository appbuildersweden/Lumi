# Supply Chain Security Reference

A guide for detecting and mitigating vulnerabilities in the software supply chain.

## SBOM (Software Bill of Materials) Generation

### Risk

When an SBOM is not maintained, it becomes difficult to grasp all dependencies included in a project, delaying vulnerability response. It is also required for compliance with regulatory requirements (US Executive Order 14028, EU CRA).

### Inspection Patterns

```bash
# Check for existence of SBOM files
find . -maxdepth 3 -name '*.spdx*' -o -name '*.cdx*' -o -name 'bom.*' \
  -o -name 'sbom.*' 2>/dev/null | head -20

# Check for CycloneDX / SPDX tool configuration
grep -rn --include='package.json' \
  -E '(@cyclonedx|spdx-sbom-generator|syft|cdxgen)' .

# Check for SBOM generation steps in CI/CD
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(cyclonedx|spdx|syft|cdxgen|sbom)' .github/ .gitlab-ci.yml 2>/dev/null
```

| Tool | Supported Formats | Supported Languages |
|------|-------------------|---------------------|
| syft | CycloneDX, SPDX | Multi-language support |
| cdxgen | CycloneDX | Node.js, Java, Python, Go |
| trivy sbom | CycloneDX, SPDX | Containers & filesystems |

## Dependency Provenance

### Risk

If the legitimacy of a package's publisher is not verified, there is a risk of incorporating tampered packages.

### Inspection Patterns

```bash
# Check for npm provenance support
grep -rn '"provenance"' package.json .npmrc 2>/dev/null

# Check registry settings in .npmrc
cat .npmrc 2>/dev/null | grep -E '(registry|@.*:registry)'

# Check for SLSA provenance verification settings
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(slsa-verifier|cosign|sigstore|attest)' .github/ 2>/dev/null
```

| SLSA Level | Requirements | Protection Scope |
|------------|-------------|------------------|
| Level 1 | Build process documentation | Build origin visibility |
| Level 2 | Hosted build service | Build tampering prevention |
| Level 3 | Build environment isolation | Source & build integrity |
| Level 4 | Two-party review + reproducible builds | Insider threat prevention |

## Typosquatting Detection

### Risk

An attack that tricks users into installing malicious packages with names closely resembling legitimate packages. Examples: `lodash` -> `lodahs`, `react` -> `reactt`.

### Inspection Patterns

```bash
# Extract and review all dependencies from package.json
cat package.json | grep -E '"[^"]+":' | \
  grep -v -E '(name|version|description|scripts|devDependencies|dependencies|peerDependencies)'

# Detect common typosquatting patterns (npm)
grep -E --include='package.json' \
  -i '(crossenv|cross-env\.|babelcli|babel-clli|event-stream|flatmap-stream)' package.json 2>/dev/null

# Detect PyPI typosquats
grep -E '(python-dateutil|python_dateutil|dateuti1|requets|reqeusts)' \
  requirements*.txt setup.py pyproject.toml 2>/dev/null

# Detect RubyGems typosquats
grep -E '(activesupport|active_suport|active-support)' Gemfile 2>/dev/null
```

**Common Typosquatting Patterns**:
- Character transposition: `lodash` -> `lodahs`
- Character addition/removal: `colors` -> `colour`
- Hyphen/underscore changes: `cross-env` -> `crossenv`
- Scope impersonation: `@angular/core` -> `angular-core`

## Lock File Integrity

### Risk

If a lock file is tampered with, unintended package versions or packages from unauthorized registries may be fetched.

### Inspection Patterns

```bash
# Check for existence of lock files
ls -la package-lock.json yarn.lock pnpm-lock.yaml Gemfile.lock \
  go.sum Cargo.lock poetry.lock 2>/dev/null

# Suspicious registry URLs in package-lock.json
grep -n '"resolved"' package-lock.json 2>/dev/null | \
  grep -v 'registry.npmjs.org' | head -20

# Suspicious registry URLs in yarn.lock
grep -n 'resolved "' yarn.lock 2>/dev/null | \
  grep -v 'registry.yarnpkg.com\|registry.npmjs.org' | head -20

# Check if lock files are tracked by Git
git ls-files package-lock.json yarn.lock pnpm-lock.yaml \
  Gemfile.lock go.sum Cargo.lock 2>/dev/null

# Verification with lockfile-lint (npm/yarn)
# npx lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https
```

## Pre/Post Install Scripts

### Risk

npm `preinstall` / `postinstall` scripts and pip `setup.py` can execute arbitrary code during package installation.

### Inspection Patterns

```bash
# Detect dangerous scripts in package.json
grep -A 1 -E '"(preinstall|postinstall|preuninstall|postuninstall|prepare)"' \
  package.json node_modules/*/package.json 2>/dev/null | \
  grep -v 'node_modules/.package-lock' | head -30

# List postinstall scripts in node_modules
find node_modules -maxdepth 2 -name 'package.json' -exec \
  grep -l '"postinstall"' {} \; 2>/dev/null

# Check for ignore-scripts setting in .npmrc
grep 'ignore-scripts' .npmrc 2>/dev/null

# Detect dangerous code in pip setup.py
grep -rn --include='setup.py' \
  -E '(os\.system|subprocess|exec\(|eval\(|urllib|requests\.get)' . 2>/dev/null
```

## Dependency Confusion

### Risk

An attack that registers a package with the same name as an internal package on a public registry, causing the build system to fetch the malicious package.

### Inspection Patterns

```bash
# Detect internal packages without a scope
grep -E '"[^@][^"]*":' package.json | \
  grep -v -E '(react|next|express|lodash|typescript|eslint|prettier|webpack|babel|jest)'

# Check scope registry settings in .npmrc
grep -E '@.*:registry' .npmrc 2>/dev/null

# pip --extra-index-url (confusion risk)
grep -rn 'extra-index-url\|--index-url' pip.conf requirements*.txt \
  pyproject.toml setup.cfg 2>/dev/null

# Go private module settings
grep 'GOPRIVATE\|GONOSUMDB\|GONOSUMCHECK' go.env .env* 2>/dev/null
cat go.env 2>/dev/null
```

**Mitigations**:
- npm: Use `@org/` scopes and pin the scope registry
- pip: Use only `--index-url` and avoid `--extra-index-url`
- Go: Set `GOPRIVATE`

## License Compliance

### Risk

Including packages with Copyleft licenses such as GPL may cause the license terms to propagate to the entire project.

### Inspection Patterns

```bash
# List npm package licenses
npx license-checker --summary 2>/dev/null || \
  npx license-checker --csv 2>/dev/null | head -30

# Detect GPL-family licenses
npx license-checker --csv 2>/dev/null | grep -iE '(GPL|AGPL|LGPL|SSPL|EUPL)'

# Check pip licenses
pip-licenses --format=csv 2>/dev/null | grep -iE '(GPL|AGPL|LGPL|SSPL)'

# Check Go licenses
go-licenses csv ./... 2>/dev/null | grep -iE '(GPL|AGPL|LGPL)'
```

| License | Type | Commercial Use Notes |
|---------|------|---------------------|
| MIT / BSD / Apache-2.0 | Permissive | Few restrictions |
| LGPL-2.1 / LGPL-3.0 | Weak Copyleft | Dynamic linking permitted |
| GPL-2.0 / GPL-3.0 | Strong Copyleft | GPL must be applied to derivatives |
| AGPL-3.0 | Network Copyleft | Also applies to SaaS usage |
| SSPL | Source Available | Restrictions on cloud services |

## Vulnerability Scanning

### Inspection Patterns

```bash
# npm audit (Node.js)
npm audit --json 2>/dev/null | head -50
npm audit --audit-level=high 2>/dev/null

# pip-audit (Python)
pip-audit --format=json 2>/dev/null | head -50

# cargo-audit (Rust)
cargo audit 2>/dev/null

# bundler-audit (Ruby)
bundle audit check --update 2>/dev/null

# govulncheck (Go)
govulncheck ./... 2>/dev/null

# Check for scanning configuration in CI/CD
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(npm audit|pip-audit|cargo.audit|bundler-audit|govulncheck|trivy|snyk|dependabot)' \
  .github/ .gitlab-ci.yml 2>/dev/null

# Check Dependabot / Renovate configuration
cat .github/dependabot.yml 2>/dev/null
cat renovate.json renovate.json5 .renovaterc 2>/dev/null
```

## Version Pinning and Hash Verification

### Risk

Version range specifications (`^`, `~`, `*`) carry a risk of automatically incorporating vulnerabilities included in newer versions.

### Inspection Patterns

```bash
# Detect version range specifications in package.json
grep -E '"[^^~><=*]' package.json | grep -v -E '(name|version|description|scripts)' | head -5
grep -E '(\^|~|\*|>=|>)' package.json | grep -v 'node_modules' | head -20

# Detect unpinned versions in requirements.txt
grep -v -E '(==|#|^$|^-r)' requirements.txt 2>/dev/null

# Detect unpinned versions in Gemfile
grep -E "gem ['\"]" Gemfile 2>/dev/null | grep -v -E '(~>|>=|=)'

# Check indirect dependencies in go.mod
grep 'indirect' go.mod 2>/dev/null | wc -l

# pip hash verification mode
grep -E '(--require-hashes|hash=sha256)' requirements*.txt 2>/dev/null

# Check package-lock.json integrity
grep '"integrity"' package-lock.json 2>/dev/null | head -5
```

## Supply Chain Security Checklist

- [ ] SBOM is generated and regularly updated
- [ ] Lock files are managed in Git and integrity is verified in CI/CD
- [ ] All dependency packages are fetched from official registries
- [ ] Internal packages have scopes (`@org/`) configured
- [ ] npm/pip/gem install scripts have been verified
- [ ] Automated vulnerability scanning (Dependabot / Renovate, etc.) is enabled
- [ ] GPL/AGPL and other Copyleft licenses do not conflict with commercial requirements
- [ ] Versions are pinned or locked via lock files
- [ ] `npm audit` / `pip-audit` etc. are executed in CI/CD
- [ ] `ignore-scripts=true` is set in `.npmrc` (with exceptions added as needed)
- [ ] SLSA provenance or npm provenance is enabled
- [ ] Typosquatting checks are performed regularly
