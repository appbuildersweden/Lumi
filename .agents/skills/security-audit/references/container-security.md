# Container & Kubernetes Security Reference

A security inspection guide for container and Kubernetes environments.

## Dockerfile Security

### Running as root User

If a container runs as root, there is a risk of gaining host root privileges upon container escape.

```bash
# Check for USER directive (absence means running as root)
grep -rn 'USER ' Dockerfile* docker/Dockerfile* 2>/dev/null

# Detect files without a USER directive
for f in $(find . -name 'Dockerfile*' -not -path '*/node_modules/*' 2>/dev/null); do
  if ! grep -q '^USER ' "$f"; then
    echo "NO USER DIRECTIVE: $f"
  fi
done

# Cases explicitly running as root
grep -rn 'USER root' Dockerfile* 2>/dev/null
```

### Usage of the latest Tag

The `latest` tag is not immutable, resulting in no reproducibility and a risk of fetching tampered images.

```bash
# Detect FROM with latest tag or no tag
grep -rn '^FROM' Dockerfile* 2>/dev/null | \
  grep -E '(:latest|[^:]+$)' | grep -v -E ':[0-9]+\.'

# Usage of latest in docker-compose.yml
grep -rn 'image:' docker-compose*.yml 2>/dev/null | \
  grep -E '(:latest|[^:]+$)' | grep -v -E ':[0-9]+\.'
```

### Secrets in Layers

Secrets copied during Docker build remain in image layers even after deletion.

```bash
# Detect copying of secret files
grep -rn --include='Dockerfile*' \
  -E '(COPY|ADD).*(\.env|\.key|\.pem|credentials|secret|password|token|id_rsa)' . 2>/dev/null

# Setting secrets via ARG/ENV
grep -rn --include='Dockerfile*' \
  -iE '(ARG|ENV).*(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)' . 2>/dev/null

# Check for usage of Docker BuildKit --mount=type=secret
grep -rn 'mount=type=secret' Dockerfile* 2>/dev/null
```

### Multi-stage Build

```bash
# Check for usage of multi-stage builds
grep -c '^FROM' Dockerfile* 2>/dev/null | grep -v ':1$'

# Check the base image of the final stage
for f in $(find . -name 'Dockerfile*' -not -path '*/node_modules/*' 2>/dev/null); do
  echo "=== $f ==="
  grep '^FROM' "$f" | tail -1
done
```

### .dockerignore

```bash
# Check for existence of .dockerignore
ls -la .dockerignore 2>/dev/null

# Check if sensitive files are included in .dockerignore
grep -E '(\.env|\.git|node_modules|\.ssh|\.aws|credentials)' \
  .dockerignore 2>/dev/null
```

## Image Scanning

### Inspection Patterns

```bash
# Check for scan configuration with Trivy
grep -rn --include='*.yml' --include='*.yaml' \
  -E '(trivy|aquasecurity/trivy|grype|docker scout|snyk container)' \
  .github/ .gitlab-ci.yml 2>/dev/null

# Check trivy.yaml configuration
cat .trivy.yaml trivy.yaml 2>/dev/null
```

| Tool | Features | Integration Method |
|------|----------|-------------------|
| Trivy | OSS, fast, multi-language support | CI/CD, GitHub Actions |
| Grype | OSS, SBOM integration | CI/CD |
| Docker Scout | Docker official, automatic SBOM generation | Docker Desktop |
| Snyk Container | Commercial, provides fix suggestions | CI/CD, IDE |

## Kubernetes RBAC

### Risk

Excessive RBAC permissions increase the risk of privilege escalation when a Pod is compromised.

```bash
# Excessive permissions in ClusterRole (wildcards)
grep -rn --include='*.yaml' --include='*.yml' \
  -A 5 'kind: ClusterRole' . 2>/dev/null | grep -E '(\*|cluster-admin)'

# Detect ClusterRoleBindings
grep -rn --include='*.yaml' --include='*.yml' \
  'kind: ClusterRoleBinding' . 2>/dev/null

# Granting cluster-admin privileges to ServiceAccounts
grep -rn --include='*.yaml' --include='*.yml' \
  -B 5 -A 10 'roleRef' . 2>/dev/null | grep -E '(cluster-admin|name:.*admin)'

# Detect usage of default ServiceAccount
grep -rn --include='*.yaml' --include='*.yml' \
  'serviceAccountName: default' . 2>/dev/null
```

## Pod Security

### SecurityContext Inspection

```bash
# Check SecurityContext settings
grep -rn --include='*.yaml' --include='*.yml' \
  -A 10 'securityContext' . 2>/dev/null | head -50

# Detect privileged containers (Critical)
grep -rn --include='*.yaml' --include='*.yml' \
  'privileged: true' . 2>/dev/null

# Detect missing runAsNonRoot setting
for f in $(find . -name '*.yaml' -o -name '*.yml' | \
  xargs grep -l 'kind: Pod\|kind: Deployment\|kind: StatefulSet' 2>/dev/null); do
  if ! grep -q 'runAsNonRoot: true' "$f"; then
    echo "NO runAsNonRoot: $f"
  fi
done

# Detect missing readOnlyRootFilesystem setting
for f in $(find . -name '*.yaml' -o -name '*.yml' | \
  xargs grep -l 'kind: Pod\|kind: Deployment\|kind: StatefulSet' 2>/dev/null); do
  if ! grep -q 'readOnlyRootFilesystem: true' "$f"; then
    echo "NO readOnlyRootFilesystem: $f"
  fi
done

# Check capabilities DROP ALL
grep -rn --include='*.yaml' --include='*.yml' \
  -A 3 'capabilities' . 2>/dev/null | grep -E '(drop|ALL)'

# Detect usage of hostNetwork / hostPID / hostIPC
grep -rn --include='*.yaml' --include='*.yml' \
  -E '(hostNetwork|hostPID|hostIPC): true' . 2>/dev/null
```

## Network Policies

### Risk

When NetworkPolicy is not configured, unrestricted communication is possible between all Pods in the cluster.

```bash
# Check for existence of NetworkPolicy
grep -rn --include='*.yaml' --include='*.yml' \
  'kind: NetworkPolicy' . 2>/dev/null

# Check for default deny policy
grep -rn --include='*.yaml' --include='*.yml' \
  -A 15 'kind: NetworkPolicy' . 2>/dev/null | grep -E '(Ingress|Egress|podSelector: {})'

# Check NetworkPolicy per Namespace
grep -rn --include='*.yaml' --include='*.yml' \
  -B 5 'kind: NetworkPolicy' . 2>/dev/null | grep 'namespace:'
```

## Kubernetes Secrets

### Risk

Kubernetes Secrets are only Base64-encoded and not encrypted. They may be stored in plaintext in etcd.

```bash
# Detect Secret manifests
grep -rn --include='*.yaml' --include='*.yml' \
  'kind: Secret' . 2>/dev/null

# Detect hardcoded Secret values
grep -rn --include='*.yaml' --include='*.yml' \
  -A 10 'kind: Secret' . 2>/dev/null | grep -E '(data:|stringData:)' -A 5

# Check for usage of ExternalSecrets / SealedSecrets
grep -rn --include='*.yaml' --include='*.yml' \
  -E '(ExternalSecret|SealedSecret|SecretStore|ClusterSecretStore)' . 2>/dev/null

# Check if Secrets are tracked by Git
git ls-files | grep -iE '(secret|credential).*\.(yaml|yml)$'
```

## Registry Security

```bash
# Check image references (whether from private registries)
grep -rn --include='*.yaml' --include='*.yml' --include='Dockerfile*' \
  -E '(image:|FROM)' . 2>/dev/null | \
  grep -v -E '(gcr\.io|\.ecr\.|\.azurecr\.|ghcr\.io|registry\.)' | head -20

# Check imagePullPolicy
grep -rn --include='*.yaml' --include='*.yml' \
  'imagePullPolicy' . 2>/dev/null

# Check image signing verification settings (cosign / Notary)
grep -rn --include='*.yaml' --include='*.yml' \
  -E '(cosign|notary|connaisseur|kyverno.*verifyImages)' . 2>/dev/null
```

## Resource Limits

### Risk

When resource limits are not set, a Pod can exhaust node resources, potentially causing a DoS.

```bash
# Check resources settings
grep -rn --include='*.yaml' --include='*.yml' \
  -A 8 'resources:' . 2>/dev/null | head -40

# Detect containers without limits set
for f in $(find . -name '*.yaml' -o -name '*.yml' | \
  xargs grep -l 'kind: Deployment\|kind: StatefulSet\|kind: DaemonSet' 2>/dev/null); do
  if ! grep -q 'limits:' "$f"; then
    echo "NO RESOURCE LIMITS: $f"
  fi
done

# Check for LimitRange
grep -rn --include='*.yaml' --include='*.yml' \
  'kind: LimitRange' . 2>/dev/null
```

## Service Mesh Security

```bash
# Check Istio / Linkerd configuration
grep -rn --include='*.yaml' --include='*.yml' \
  -E '(istio|linkerd|PeerAuthentication|AuthorizationPolicy)' . 2>/dev/null

# Check mTLS settings
grep -rn --include='*.yaml' --include='*.yml' \
  -A 5 'PeerAuthentication' . 2>/dev/null | grep -E '(STRICT|PERMISSIVE|DISABLE)'

# Detect mTLS in PERMISSIVE (non-enforced) mode
grep -rn --include='*.yaml' --include='*.yml' \
  'mode: PERMISSIVE' . 2>/dev/null
```

## Common Misconfigurations

| Severity | Misconfiguration | Impact |
|----------|-----------------|--------|
| Critical | Container with `privileged: true` | Host root access upon container escape |
| Critical | `*` permissions in ClusterRole | Full cluster control possible |
| Critical | Secrets committed to Git | Leakage of all credentials |
| High | Running as root user | Privilege escalation within container |
| High | Usage of latest tag | Lack of reproducibility, tampering risk |
| High | No NetworkPolicy configured | Unrestricted communication between Pods |
| High | No Resource Limits set | DoS risk |
| Medium | readOnlyRootFilesystem not set | Persistent malware placement |
| Medium | .dockerignore not configured | Sensitive files included in build context |
| Medium | mTLS set to PERMISSIVE | Communication eavesdropping risk |
| Low | imagePullPolicy: Always not set | Usage of cached outdated images |

## Container & Kubernetes Security Checklist

- [ ] All Dockerfiles have a `USER` directive and run as non-root
- [ ] Image tags are pinned to specific versions (`latest` not used)
- [ ] Multi-stage builds are used to minimize the final image
- [ ] `.dockerignore` includes `.env`, `.git`, `node_modules`, etc.
- [ ] Secrets are injected using BuildKit `--mount=type=secret`
- [ ] Image scanning (Trivy / Grype) is executed in CI/CD
- [ ] Pods have `securityContext` configured (runAsNonRoot, readOnlyRootFilesystem)
- [ ] No containers with `privileged: true` exist
- [ ] Capabilities are minimized with `drop: ["ALL"]`
- [ ] NetworkPolicy with default deny is configured
- [ ] Kubernetes Secrets are integrated with an external secret manager
- [ ] RBAC does not use wildcard permissions
- [ ] Resource Limits (CPU / Memory) are set for all containers
- [ ] Service Mesh mTLS is configured in STRICT mode
- [ ] Image signing and verification (e.g., cosign) is enabled
