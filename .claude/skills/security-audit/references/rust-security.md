# Rust Security Testing Reference

Vulnerability patterns and testing guide specific to Rust. Covers unsafe blocks, FFI boundaries, and web framework support.

## Unsafe Code

### Risk

Within `unsafe` blocks, the compiler's memory safety guarantees are bypassed. Use-after-free, buffer overflows, and undefined behavior can occur.

### Testing Patterns

```bash
# All locations of unsafe blocks
grep -rn --include='*.rs' 'unsafe\s*{' . | grep -v target | grep -v vendor

# unsafe fn definitions
grep -rn --include='*.rs' 'unsafe\s*fn' . | grep -v target | grep -v vendor

# unsafe impl (manual implementation of Send / Sync)
grep -rn --include='*.rs' 'unsafe\s*impl' . | grep -v target | grep -v vendor

# Usage of raw pointers
grep -rn --include='*.rs' -E '(\*const\s|\*mut\s|as\s+\*const|as\s+\*mut)' . | grep -v target | grep -v vendor

# transmute (forced type conversion, extremely dangerous)
grep -rn --include='*.rs' 'transmute' . | grep -v target | grep -v vendor

# ptr::read / ptr::write
grep -rn --include='*.rs' -E '(ptr::(read|write|copy|swap|drop_in_place))' . | grep -v target | grep -v vendor

# Verify SAFETY comments (justification for unsafe usage)
grep -rn --include='*.rs' -B1 'unsafe' . | grep -i 'SAFETY' | grep -v target
```

## FFI Security

### Risk

Interoperation with C via `extern "C"` moves memory safety outside of Rust. NULL pointers, buffer overflows, and memory leaks can occur.

### Testing Patterns

```bash
# extern "C" blocks
grep -rn --include='*.rs' 'extern\s*"C"' . | grep -v target | grep -v vendor

# FFI function calls
grep -rn --include='*.rs' -E '(CString|CStr|c_char|c_int|c_void)' . | grep -v target | grep -v vendor

# Usage of libc crate
grep -rn --include='*.rs' 'libc::' . | grep -v target | grep -v vendor

# Verify bindgen generated code
grep -rn 'bindgen' Cargo.toml 2>/dev/null

# NULL checks at FFI boundaries
grep -rn --include='*.rs' -E '(is_null|NonNull|as_ref\(\))' . | grep -v target | grep -v vendor

# Box::from_raw (ownership transfer, double-free risk)
grep -rn --include='*.rs' 'Box::from_raw' . | grep -v target | grep -v vendor

# forget (memory leak)
grep -rn --include='*.rs' 'mem::forget\|std::mem::forget' . | grep -v target | grep -v vendor
```

## Memory Safety

### Risk

Use-after-free, dangling pointers, and buffer overflows within unsafe code are not detected by the Rust compiler.

### Testing Patterns

```bash
# slice::from_raw_parts (buffer overflow risk)
grep -rn --include='*.rs' 'from_raw_parts' . | grep -v target | grep -v vendor

# ManuallyDrop (manual memory management)
grep -rn --include='*.rs' 'ManuallyDrop' . | grep -v target | grep -v vendor

# MaybeUninit (uninitialized memory)
grep -rn --include='*.rs' 'MaybeUninit' . | grep -v target | grep -v vendor

# Usage of Pin (safety of self-referential structs)
grep -rn --include='*.rs' -E '(Pin<|pin_mut!|Unpin)' . | grep -v target | grep -v vendor

# Manual alloc / dealloc calls
grep -rn --include='*.rs' -E '(alloc::(alloc|dealloc|realloc)|GlobalAlloc)' . | grep -v target | grep -v vendor

# offset / add / sub (pointer arithmetic)
grep -rn --include='*.rs' -E '\.(offset|add|sub)\(' . | grep -v target | grep -v vendor | grep -i ptr
```

## Cryptography

### Risk

Implementation mistakes in cryptographic processing lead to critical security holes. The main risks are lack of constant-time comparison, usage of weak algorithms, and improper random number generation.

### Testing Patterns

```bash
# Verify usage of cryptographic libraries
grep -rn -E '(ring|rustls|RustCrypto|aes|sha2|hmac|argon2|bcrypt|chacha20)' Cargo.toml 2>/dev/null

# Usage of rand crate (verify OsRng / ThreadRng)
grep -rn --include='*.rs' -E '(OsRng|ThreadRng|StdRng|thread_rng|rand::)' . | grep -v target | grep -v vendor

# Fixed-seed random number generation (dangerous outside tests)
grep -rn --include='*.rs' 'SeedableRng\|seed_from_u64\|from_seed' . | grep -v target | grep -v vendor | grep -v test

# Constant-time comparison (timing attack prevention)
grep -rn --include='*.rs' -E '(constant_time|ct_eq|subtle::)' . | grep -v target | grep -v vendor

# Usage of MD5 / SHA1 (weak hashes)
grep -rn --include='*.rs' -E '(md5|sha1|Md5|Sha1)[^a-zA-Z]' . | grep -v target | grep -v vendor

# Hardcoded cryptographic keys
grep -rn --include='*.rs' -E '(b"|&\[)[0-9a-fA-Fx, ]+\]' . | grep -v target | grep -v vendor | grep -i key
```

## Input Validation

### Risk

The main risks are integer overflow (wraps around in release builds), panic from `unwrap()`, and insufficient validation.

### Testing Patterns

```bash
# Usage of unwrap (panic risk in production code)
grep -rn --include='*.rs' '\.unwrap()' . | grep -v target | grep -v vendor | grep -v test

# Usage of expect (verify appropriateness in production code)
grep -rn --include='*.rs' '\.expect(' . | grep -v target | grep -v vendor | grep -v test

# Integer arithmetic (overflow risk)
grep -rn --include='*.rs' -E '(checked_add|checked_sub|checked_mul|saturating_|overflowing_|wrapping_)' . | grep -v target | grep -v vendor

# Casts via as (precision loss, sign conversion)
grep -rn --include='*.rs' -E '\bas\s+(u8|u16|u32|i8|i16|i32|usize|isize)\b' . | grep -v target | grep -v vendor

# Error handling during numeric parsing
grep -rn --include='*.rs' -E '\.parse::<(u|i|f)\w+>\(\)' . | grep -v target | grep -v vendor

# Enable clippy integer cast warnings
grep -rn 'clippy::cast' . --include='*.rs' | grep -v target
```

## Error Handling

### Risk

`unwrap()` / `expect()` cause panics that lead to service outage (DoS). Proper handling of `Result` / `Option` is required in production code.

### Testing Patterns

```bash
# Count of unwrap usage
grep -c --include='*.rs' -r '\.unwrap()' . 2>/dev/null | grep -v ':0$' | grep -v target | sort -t: -k2 -rn | head -10

# panic! macro
grep -rn --include='*.rs' 'panic!\(' . | grep -v target | grep -v vendor | grep -v test

# todo! / unimplemented! (remaining in production code)
grep -rn --include='*.rs' -E '(todo!|unimplemented!)' . | grep -v target | grep -v vendor

# Usage of unreachable! (UB if actually reachable)
grep -rn --include='*.rs' 'unreachable!' . | grep -v target | grep -v vendor

# Sensitive information in error messages
grep -rn --include='*.rs' -E '(eprintln!|tracing::(error|warn)).*password\|secret\|token\|key' . | grep -v target
```

## Web Frameworks (Actix-web / Axum / Rocket)

### Testing Patterns

```bash
# Identify framework
grep -E '(actix-web|axum|rocket|warp|tide)' Cargo.toml 2>/dev/null

# Actix-web: Extractor validation
grep -rn --include='*.rs' -E '(web::(Json|Query|Path|Form)|HttpRequest)' . | grep -v target | grep -v vendor

# Axum: Extractor usage
grep -rn --include='*.rs' -E '(axum::extract|Extension|State<)' . | grep -v target | grep -v vendor

# CORS settings
grep -rn --include='*.rs' -E '(Cors|cors|CorsLayer|AllowOrigin)' . | grep -v target | grep -v vendor

# Wildcard CORS (dangerous)
grep -rn --include='*.rs' -E '(permissive|any\(\)|allow_any_origin)' . | grep -v target | grep -v vendor

# Authentication middleware
grep -rn --include='*.rs' -E '(middleware|guard|FromRequest|from_request)' . | grep -v target | grep -v vendor | grep -i auth

# Rate limiting
grep -rn --include='*.rs' -E '(rate_limit|throttle|governor|RateLimiter)' . | grep -v target | grep -v vendor

# Security header settings
grep -rn --include='*.rs' -E '(X-Frame-Options|Content-Security-Policy|Strict-Transport|helmet)' . | grep -v target
```

## SQL (sqlx / diesel)

### Testing Patterns

```bash
# Verify sqlx usage
grep 'sqlx' Cargo.toml 2>/dev/null

# Verify diesel usage
grep 'diesel' Cargo.toml 2>/dev/null

# sqlx compile-time verified queries (safe)
grep -rn --include='*.rs' -E '(sqlx::query!|query_as!)' . | grep -v target | grep -v vendor

# sqlx dynamic queries (SQL Injection risk)
grep -rn --include='*.rs' -E '(sqlx::query\(|QueryBuilder)' . | grep -v target | grep -v vendor

# SQL construction via format! (dangerous)
grep -rn --include='*.rs' 'format!.*SELECT\|format!.*INSERT\|format!.*UPDATE\|format!.*DELETE' . | grep -v target | grep -v vendor

# diesel raw SQL
grep -rn --include='*.rs' -E '(sql_query|diesel::sql_query)' . | grep -v target | grep -v vendor
```

## Dependency Security

### Testing Patterns

```bash
# Vulnerability check via cargo-audit
cargo audit 2>/dev/null || echo "cargo-audit not installed"

# Comprehensive check via cargo-deny
cargo deny check 2>/dev/null || echo "cargo-deny not installed"

# Verify Cargo.lock exists (required for binary projects)
ls -la Cargo.lock 2>/dev/null || echo "Cargo.lock not found"

# List dependencies
cargo tree --depth 1 2>/dev/null | head -30

# Check for yanked crates
cargo audit --deny yanked 2>/dev/null

# Usage of unsafe crates (cargo-geiger)
cargo geiger 2>/dev/null || echo "cargo-geiger not installed"
```

## Concurrency Safety

### Risk

Incorrect implementation of `Send` / `Sync` within unsafe code causes data races. Detection is difficult since compiler protections are bypassed.

### Testing Patterns

```bash
# unsafe impl Send / Sync (manual implementation requires review)
grep -rn --include='*.rs' -E 'unsafe\s+impl\s+(Send|Sync)' . | grep -v target | grep -v vendor

# Arc / Mutex usage patterns
grep -rn --include='*.rs' -E '(Arc<|Mutex<|RwLock<|AtomicBool|AtomicUsize)' . | grep -v target | grep -v vendor

# Usage of crossbeam
grep -rn --include='*.rs' 'crossbeam' . | grep -v target | grep -v vendor

# Shared state in tokio::spawn
grep -rn --include='*.rs' 'tokio::spawn' . | grep -v target | grep -v vendor

# static mut (data race risk, deprecated)
grep -rn --include='*.rs' 'static\s*mut' . | grep -v target | grep -v vendor
```

## Serialization (serde)

### Risk

Deserialization from untrusted sources can cause memory exhaustion (huge arrays) and logic bugs.

### Testing Patterns

```bash
# Verify serde usage
grep 'serde' Cargo.toml 2>/dev/null

# Derive of Deserialize
grep -rn --include='*.rs' 'Deserialize' . | grep -v target | grep -v vendor

# Custom Deserialize implementation (logic bug risk)
grep -rn --include='*.rs' "impl.*Deserialize.*for" . | grep -v target | grep -v vendor

# serde_json::from_str / from_slice (verify input size limits)
grep -rn --include='*.rs' -E '(from_str|from_slice|from_reader)\(' . | grep -v target | grep -v vendor | grep -i serde

# #[serde(deny_unknown_fields)] (reject unknown fields)
grep -rn --include='*.rs' 'deny_unknown_fields' . | grep -v target | grep -v vendor

# Binary formats like bincode / postcard
grep -rn -E '(bincode|postcard|ciborium|rmp-serde)' Cargo.toml 2>/dev/null
```

## File System

### Risk

The main risks are path traversal (directory escape via `../`) and TOCTOU (Time-of-check-to-time-of-use).

### Testing Patterns

```bash
# User input used in file paths
grep -rn --include='*.rs' -E '(Path::new|PathBuf::from)\(' . | grep -v target | grep -v vendor

# File operations
grep -rn --include='*.rs' -E '(fs::(read|write|remove|create_dir|rename|copy)|File::(open|create))' . | grep -v target | grep -v vendor

# Path normalization via canonicalize (has TOCTOU risk)
grep -rn --include='*.rs' 'canonicalize' . | grep -v target | grep -v vendor

# Usage of tempfile (safe temporary files)
grep -rn --include='*.rs' 'tempfile' . | grep -v target | grep -v vendor

# Path prefix validation
grep -rn --include='*.rs' 'starts_with\|strip_prefix' . | grep -v target | grep -v vendor | grep -i path

# Symbolic link following
grep -rn --include='*.rs' -E '(symlink_metadata|read_link|follow_links)' . | grep -v target | grep -v vendor
```

## Unsafe Code Classification

| Pattern | Risk Level | Description |
|---------|------------|-------------|
| `unsafe { }` block | Medium-High | Bypasses compiler protections |
| `unsafe fn` | High | Transfers safety responsibility to caller |
| `unsafe impl Send/Sync` | Critical | Manually guarantees concurrency safety |
| `transmute` | Critical | Arbitrary type conversion, risk of UB |
| `from_raw_parts` | High | Buffer overflow risk |
| `static mut` | Critical | Data race, deprecated |
| `extern "C"` | High | FFI boundary, memory safety discontinuity |

## Rust Security Checklist

- [ ] `unsafe` blocks are minimal and each location has a SAFETY comment
- [ ] Usage of `transmute` is justified
- [ ] NULL checks and buffer size validation exist at FFI boundaries
- [ ] `unsafe impl Send/Sync` is proven not to cause data races
- [ ] `static mut` is not used (alternatives: `OnceLock`, `Atomic*`, `Mutex`)
- [ ] Proven crates like `ring` / `RustCrypto` are used for cryptographic processing
- [ ] Fixed-seed random number generation is not used outside tests
- [ ] `unwrap()` / `expect()` are properly handled in production code
- [ ] `todo!` / `unimplemented!` do not remain in production code
- [ ] SQL queries use `sqlx::query!` macros or are parameterized
- [ ] CORS does not allow wildcard origins
- [ ] Authentication middleware is set on web endpoints
- [ ] Zero known vulnerabilities via `cargo audit`
- [ ] `Cargo.lock` is committed to the repository
- [ ] Integer arithmetic uses `checked_*` / `saturating_*` methods
- [ ] Path traversal prevention (prefix validation) is implemented
- [ ] serde deserialization has input size limits
