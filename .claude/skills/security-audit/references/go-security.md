# Go Security Testing Reference

Vulnerability patterns and testing guide specific to Go. Covers goroutine safety, the unsafe package, and web framework support.

## SQL Injection

### Risk

SQL Injection occurs when SQL is passed to `Query()` / `Exec()` of the `database/sql` package via string concatenation. The same risk applies when using raw queries with GORM or sqlx.

### Testing Patterns

```bash
# SQL construction via string concatenation
grep -rn --include='*.go' \
  -E '(db\.(Query|Exec|QueryRow)\(.*(\+|fmt\.Sprintf|fmt\.Fprintf))' . | grep -v vendor

# GORM raw queries
grep -rn --include='*.go' -E '(\.Raw\(|\.Exec\().*(\+|fmt\.Sprintf)' . | grep -v vendor

# sqlx raw queries
grep -rn --include='*.go' -E '(sqlx\.(Get|Select|Exec)|\.NamedExec)' . | grep -v vendor

# SQL construction via fmt.Sprintf (dangerous)
grep -rn --include='*.go' 'fmt\.Sprintf.*SELECT\|fmt\.Sprintf.*INSERT\|fmt\.Sprintf.*UPDATE\|fmt\.Sprintf.*DELETE' . | grep -v vendor

# Placeholder verification (safe pattern)
grep -rn --include='*.go' -E '(db\.(Query|Exec|QueryRow)\(.*\$[0-9]|\?)' . | grep -v vendor
```

## Command Injection

### Risk

Arbitrary command execution is possible when user input is included in external command execution via the `os/exec` package or `syscall`.

### Testing Patterns

```bash
# Usage of os/exec
grep -rn --include='*.go' -E '(exec\.Command\(|exec\.CommandContext\()' . | grep -v vendor

# Usage of syscall.Exec
grep -rn --include='*.go' 'syscall\.Exec' . | grep -v vendor

# Pattern of user input passed to commands
grep -rn --include='*.go' -E 'exec\.Command\(.*r\.(Form|URL|Body|Header)' . | grep -v vendor

# Execution via sh -c (especially dangerous)
grep -rn --include='*.go' -E 'exec\.Command\("(sh|bash|cmd)"' . | grep -v vendor
```

## Path Traversal

### Risk

`filepath.Join()` does not prevent path traversal (it normalizes `../` but the joined result may still point outside the intended directory).

### Testing Patterns

```bash
# User input used in filepath.Join
grep -rn --include='*.go' -E 'filepath\.Join\(.*r\.(Form|URL|Param)' . | grep -v vendor

# User input in os.Open / os.ReadFile
grep -rn --include='*.go' -E '(os\.Open|os\.ReadFile|ioutil\.ReadFile)\(' . | grep -v vendor

# http.ServeFile (path traversal risk)
grep -rn --include='*.go' 'http\.ServeFile' . | grep -v vendor

# Verify sanitization via filepath.Clean
grep -rn --include='*.go' 'filepath\.Clean' . | grep -v vendor

# Path prefix validation
grep -rn --include='*.go' 'strings\.HasPrefix' . | grep -v vendor | grep -i path
```

## Race Conditions

### Risk

Concurrent access to shared variables across goroutines causes data races. These can be detected with the `-race` flag during testing.

### Testing Patterns

```bash
# Goroutine usage locations
grep -rn --include='*.go' 'go func\(' . | grep -v vendor

# Mutation of global variables (race condition risk)
grep -rn --include='*.go' -E '^var\s+\w+\s+(map|slice|\[\])' . | grep -v vendor

# Usage of sync package (verify proper protection)
grep -rn --include='*.go' -E '(sync\.(Mutex|RWMutex|Map|WaitGroup|Once))' . | grep -v vendor

# Usage of atomic package
grep -rn --include='*.go' 'atomic\.' . | grep -v vendor

# Usage of channels
grep -rn --include='*.go' -E 'make\(chan\s' . | grep -v vendor

# Run tests with race detector
# go test -race ./...
```

## Memory Safety (unsafe)

### Risk

The `unsafe` package completely bypasses memory safety. Buffer overflows and type safety violations become possible.

### Testing Patterns

```bash
# Usage of unsafe package
grep -rn --include='*.go' '"unsafe"' . | grep -v vendor
grep -rn --include='*.go' 'unsafe\.Pointer' . | grep -v vendor

# Type manipulation via reflect package
grep -rn --include='*.go' 'reflect\.Value' . | grep -v vendor | grep -i 'unsafe\|pointer'

# Usage of cgo
grep -rn --include='*.go' -E '(import "C"|/\*.*#include)' . | grep -v vendor

# Accessing unexported functions via //go:linkname
grep -rn --include='*.go' '//go:linkname' . | grep -v vendor

# //go:nosplit / //go:noescape
grep -rn --include='*.go' -E '//go:(nosplit|noescape)' . | grep -v vendor
```

## Cryptography

### Risk

`math/rand` is not cryptographically secure. Using weak hash algorithms (MD5, SHA1) for passwords or signatures is dangerous.

### Testing Patterns

```bash
# Usage of math/rand (dangerous for cryptographic purposes)
grep -rn --include='*.go' '"math/rand"' . | grep -v vendor

# Usage of crypto/rand (safe)
grep -rn --include='*.go' '"crypto/rand"' . | grep -v vendor

# Weak hashes (MD5, SHA1)
grep -rn --include='*.go' -E '(md5\.(New|Sum)|sha1\.(New|Sum)|crypto\.MD5|crypto\.SHA1)' . | grep -v vendor

# Hardcoded cryptographic keys
grep -rn --include='*.go' -E '([]byte\("|key\s*:?=\s*\[\]byte)' . | grep -v vendor | grep -v test

# AES in ECB mode (dangerous)
grep -rn --include='*.go' 'cipher\.NewECB' . | grep -v vendor

# Usage of proper cryptographic libraries
grep -rn --include='*.go' -E '(golang\.org/x/crypto|crypto/aes|crypto/tls)' . | grep -v vendor
```

## HTTP Security

### Testing Patterns

```bash
# CORS settings
grep -rn --include='*.go' -E '(Access-Control-Allow-Origin|cors\.)' . | grep -v vendor

# Wildcard CORS (dangerous)
grep -rn --include='*.go' -E "Allow-Origin.*\*|AllowAllOrigins.*true" . | grep -v vendor

# HTTP timeout settings verification
grep -rn --include='*.go' -E '(ReadTimeout|WriteTimeout|IdleTimeout|ReadHeaderTimeout)' . | grep -v vendor

# http.ListenAndServe without timeout (Slowloris attack risk)
grep -rn --include='*.go' 'http\.ListenAndServe\(' . | grep -v vendor

# TLS settings
grep -rn --include='*.go' -E '(tls\.Config|MinVersion|CipherSuites)' . | grep -v vendor

# Security header settings
grep -rn --include='*.go' -E '(X-Frame-Options|X-Content-Type|Strict-Transport|Content-Security-Policy)' . | grep -v vendor

# Cookie Secure / HttpOnly flags
grep -rn --include='*.go' -E '(http\.Cookie|Secure:|HttpOnly:)' . | grep -v vendor
```

## Input Validation

### Testing Patterns

```bash
# Integer overflow risk (error handling in strconv)
grep -rn --include='*.go' -E 'strconv\.(Atoi|ParseInt|ParseUint)' . | grep -v vendor
# -> Verify error checks exist

# Direct use of user input
grep -rn --include='*.go' -E 'r\.(FormValue|URL\.Query|PostFormValue|PathValue)\(' . | grep -v vendor

# Usage of validation libraries
grep -rn --include='*.go' -E '(validator\.Validate|validate:"required)' . | grep -v vendor

# Error handling for JSON decoding
grep -rn --include='*.go' 'json\.Decode\|json\.Unmarshal' . | grep -v vendor
```

## Error Handling

### Risk

Ignoring errors in Go's error handling can lead to hidden security bugs. Additionally, `panic` can lead to DoS.

### Testing Patterns

```bash
# Ignored errors (assigned to _)
grep -rn --include='*.go' -E '(,\s*_\s*:?=|_\s*=.*err)' . | grep -v vendor | grep -v test

# Usage of panic (should be avoided in production code)
grep -rn --include='*.go' 'panic\(' . | grep -v vendor | grep -v test

# Verify usage of recover
grep -rn --include='*.go' 'recover\(\)' . | grep -v vendor

# log.Fatal (deferred functions are not executed)
grep -rn --include='*.go' 'log\.Fatal' . | grep -v vendor

# Potential sensitive information in error messages
grep -rn --include='*.go' -E '(fmt\.Errorf|errors\.New).*password\|secret\|token\|key' . | grep -v vendor
```

## Template Injection

### Risk

`text/template` does not perform HTML escaping. Always use `html/template` for web output.

### Testing Patterns

```bash
# Usage of text/template (XSS risk for web output)
grep -rn --include='*.go' '"text/template"' . | grep -v vendor

# Usage of html/template (safe)
grep -rn --include='*.go' '"html/template"' . | grep -v vendor

# Explicit escape disabling via template.HTML()
grep -rn --include='*.go' 'template\.HTML\(' . | grep -v vendor

# Usage of template.JS / template.URL
grep -rn --include='*.go' -E 'template\.(JS|URL|CSS)\(' . | grep -v vendor
```

## TLS Configuration

### Testing Patterns

```bash
# TLS minimum version
grep -rn --include='*.go' 'MinVersion' . | grep -v vendor

# Deprecated TLS versions (TLS 1.0, 1.1)
grep -rn --include='*.go' -E '(VersionTLS10|VersionTLS11|VersionSSL)' . | grep -v vendor

# InsecureSkipVerify (disabling certificate verification)
grep -rn --include='*.go' 'InsecureSkipVerify\s*:\s*true' . | grep -v vendor

# Weak cipher suites
grep -rn --include='*.go' -E '(TLS_RSA_|TLS_ECDHE.*RC4|TLS_ECDHE.*3DES)' . | grep -v vendor
```

## Dependency Security

### Testing Patterns

```bash
# Verify go.sum exists
ls -la go.sum 2>/dev/null || echo "go.sum not found"

# Vulnerability check via govulncheck
govulncheck ./... 2>/dev/null || echo "govulncheck not installed"

# Dependency version check in go.mod
cat go.mod 2>/dev/null | grep -E '^\t'

# replace directives (verify local patches)
grep 'replace' go.mod 2>/dev/null

# Check for outdated dependencies
go list -m -u all 2>/dev/null | grep '\[' | head -20
```

## Go Security Checklist

- [ ] SQL queries use placeholders (`$1`, `?`)
- [ ] User input is not passed directly to `os/exec`
- [ ] Results of `filepath.Join` are verified to be within allowed directories
- [ ] Shared variables across goroutines are protected with `sync.Mutex` / `sync.RWMutex`
- [ ] Usage of the `unsafe` package is minimal and reviewed
- [ ] `crypto/rand` is used for cryptographic purposes (not `math/rand`)
- [ ] HTTP servers have timeouts configured
- [ ] CORS does not allow wildcard origins
- [ ] `text/template` is not used for web output
- [ ] TLS 1.2 or higher is configured
- [ ] `InsecureSkipVerify` is not set to `true` in production code
- [ ] `panic` is not used in normal flow of production code
- [ ] Errors are properly handled and not ignored
- [ ] Zero known vulnerabilities via `govulncheck`
- [ ] `go.sum` is committed to the repository
- [ ] Tests pass with the `-race` flag
