# Ruby on Rails Security Testing Reference

Vulnerability patterns and testing guide specific to Ruby on Rails. Based on Brakeman rules + OWASP Top 10.

## SQL Injection

### Risk

SQL Injection occurs when passing strings directly to ActiveRecord's `where`, using `find_by_sql`, or executing raw SQL via `execute`. Corresponds to Brakeman's SQL Injection warnings.

### Testing Patterns

```bash
# String interpolation in where (dangerous)
grep -rn --include='*.rb' -E '\.where\(\s*".*#\{' . | grep -v vendor | grep -v test

# String concatenation in where
grep -rn --include='*.rb' -E '\.where\(.*\+' . | grep -v vendor | grep -v test

# find_by_sql
grep -rn --include='*.rb' 'find_by_sql' . | grep -v vendor

# Raw SQL execution
grep -rn --include='*.rb' -E '(\.execute\(|connection\.exec|ActiveRecord::Base\.connection)' . | grep -v vendor

# String passed directly to order / group
grep -rn --include='*.rb' -E '\.(order|group|pluck|select)\(.*#\{' . | grep -v vendor

# Verify usage of sanitize_sql (safety measure)
grep -rn --include='*.rb' 'sanitize_sql' . | grep -v vendor

# Verify usage of Arel (safe query builder)
grep -rn --include='*.rb' 'Arel' . | grep -v vendor
```

## XSS (Cross-Site Scripting)

### Risk

Rails escapes view output by default, but escaping can be disabled with `html_safe`, `raw`, and `<%== %>`.

### Testing Patterns

```bash
# Usage of html_safe (Brakeman: CrossSiteScripting)
grep -rn --include='*.rb' --include='*.erb' '\.html_safe' . | grep -v vendor | grep -v test

# Usage of raw helper
grep -rn --include='*.erb' '\braw\b' . | grep -v vendor

# Escape disabling via <%== %>
grep -rn --include='*.erb' '<%==' . | grep -v vendor

# User input in content_tag (attribute injection)
grep -rn --include='*.rb' --include='*.erb' 'content_tag.*params' . | grep -v vendor

# User input in link_to href (javascript: scheme)
grep -rn --include='*.rb' --include='*.erb' -E 'link_to.*params\[' . | grep -v vendor

# Verify usage of sanitize helper
grep -rn --include='*.rb' --include='*.erb' '\bsanitize\b' . | grep -v vendor
```

## CSRF Protection

### Testing Patterns

```bash
# protect_from_forgery setting
grep -rn --include='*.rb' 'protect_from_forgery' . | grep -v vendor

# Verify protect_from_forgery is in ApplicationController
grep -A5 'class ApplicationController' app/controllers/application_controller.rb 2>/dev/null

# skip_forgery_protection / skip_before_action :verify_authenticity_token
grep -rn --include='*.rb' -E '(skip_forgery_protection|skip_before_action.*verify_authenticity_token)' . | grep -v vendor

# Verify API mode (CSRF may be disabled)
grep -rn --include='*.rb' 'config\.api_only' . | grep -v vendor
```

## Mass Assignment

### Risk

Passing `params` directly to `create` / `update` without Strong Parameters allows attackers to modify arbitrary columns.

### Testing Patterns

```bash
# Usage of params without permit (Brakeman: MassAssignment)
grep -rn --include='*.rb' -E '\.(create|update|new|assign_attributes)\(params\b' . | grep -v vendor

# Wildcard permit (allowing all attributes is dangerous)
grep -rn --include='*.rb' 'permit!' . | grep -v vendor

# Verify permit contents (privileged attributes like admin, role)
grep -rn --include='*.rb' -A3 '\.permit\(' . | grep -v vendor

# Strong Parameters method definitions
grep -rn --include='*.rb' -E 'def \w+_params' . | grep -v vendor
```

## Authentication

### Testing Patterns

```bash
# Devise settings
grep -rn --include='*.rb' 'devise' . | grep -v vendor | head -20

# Usage of has_secure_password
grep -rn --include='*.rb' 'has_secure_password' . | grep -v vendor

# authenticate_user! filter
grep -rn --include='*.rb' 'authenticate_user!' . | grep -v vendor

# Authentication check in before_action
grep -rn --include='*.rb' 'before_action.*authenticate' . | grep -v vendor

# Authentication skip via skip_before_action (requires review)
grep -rn --include='*.rb' 'skip_before_action.*authenticate' . | grep -v vendor

# Password minimum length setting
grep -rn --include='*.rb' -E '(password.*length|minimum.*password|validates.*password)' . | grep -v vendor
```

## Authorization

### Testing Patterns

```bash
# Usage of Pundit
grep -rn --include='*.rb' -E '(authorize|policy\(|PolicyScope)' . | grep -v vendor

# Usage of CanCanCan
grep -rn --include='*.rb' -E '(can\?|authorize!|load_and_authorize|CanCan)' . | grep -v vendor

# Controller actions without authorization checks
for f in $(find app/controllers -name '*.rb' 2>/dev/null); do
  if ! grep -qE '(authorize|can\?|policy|before_action.*(admin|role|permission))' "$f" 2>/dev/null; then
    echo "NO AUTHZ: $f"
  fi
done

# Owner check via current_user (IDOR prevention)
grep -rn --include='*.rb' -E '(\.find\(params|\.find_by.*params)' app/controllers/ 2>/dev/null
# -> Verify it is current_user.xxx.find
```

## File Upload

### Testing Patterns

```bash
# Usage of ActiveStorage
grep -rn --include='*.rb' 'has_one_attached\|has_many_attached' . | grep -v vendor

# Usage of CarrierWave
grep -rn --include='*.rb' 'mount_uploader' . | grep -v vendor

# Usage of Shrine
grep -rn --include='*.rb' 'include.*Shrine' . | grep -v vendor

# Content-Type validation
grep -rn --include='*.rb' -E '(content_type|allowed_types|validate.*content)' . | grep -v vendor

# File size limits
grep -rn --include='*.rb' -E '(size.*limit|file_size|max.*size|validate.*size)' . | grep -v vendor

# Path traversal: User input used as filename
grep -rn --include='*.rb' -E '(File\.join|Pathname\.new).*params' . | grep -v vendor
```

## Open Redirect

### Risk

Passing user input directly to `redirect_to` allows redirection to external sites. Corresponds to Brakeman's Redirect warnings.

### Testing Patterns

```bash
# Passing parameters directly to redirect_to (Brakeman: Redirect)
grep -rn --include='*.rb' -E 'redirect_to.*params\[' . | grep -v vendor

# redirect_back fallback_location
grep -rn --include='*.rb' 'redirect_back' . | grep -v vendor

# allow_other_host option
grep -rn --include='*.rb' 'allow_other_host' . | grep -v vendor

# URL validation
grep -rn --include='*.rb' -E '(URI\.parse|url_for|polymorphic_path)' . | grep -v vendor
```

## Session Security

### Testing Patterns

```bash
# Session settings
grep -rn --include='*.rb' -E '(session_store|cookie_store|session\[)' . | grep -v vendor

# Cookie settings (Secure, HttpOnly, SameSite)
grep -rn --include='*.rb' -E '(secure:|httponly:|same_site:)' . | grep -v vendor

# config/initializers/session_store.rb
cat config/initializers/session_store.rb 2>/dev/null

# Session fixation attack prevention (reset_session)
grep -rn --include='*.rb' 'reset_session' . | grep -v vendor

# config.force_ssl (force HTTPS)
grep -rn --include='*.rb' 'force_ssl' . | grep -v vendor
```

## Secrets Management

### Testing Patterns

```bash
# Verify credentials.yml.enc exists
ls -la config/credentials.yml.enc 2>/dev/null

# master.key tracked by Git (dangerous)
git ls-files config/master.key 2>/dev/null

# .env files tracked by Git
git ls-files .env .env.local .env.production 2>/dev/null

# Hardcoded secret keys
grep -rn --include='*.rb' -E '(secret_key|api_key|password)\s*=\s*["\x27]' . | grep -v vendor | grep -v test

# Verify usage of ENV
grep -rn --include='*.rb' 'ENV\[' . | grep -v vendor | head -20

# Usage of Rails.application.credentials
grep -rn --include='*.rb' 'Rails\.application\.credentials' . | grep -v vendor
```

## Command Injection

### Risk

Passing user input to `system`, backticks, `%x`, or `Open3` allows arbitrary command execution. Corresponds to Brakeman's Execute warnings.

### Testing Patterns

```bash
# system / exec commands (Brakeman: Execute)
grep -rn --include='*.rb' -E '\b(system|exec)\(.*params' . | grep -v vendor

# Backtick execution
grep -rn --include='*.rb' '`.*#\{' . | grep -v vendor

# Execution via %x
grep -rn --include='*.rb' '%x[({]' . | grep -v vendor

# Execution via Open3
grep -rn --include='*.rb' 'Open3\.' . | grep -v vendor

# Kernel.open (command injection possible)
grep -rn --include='*.rb' -E '(Kernel\.open|URI\.open)\(.*params' . | grep -v vendor

# send method (method injection)
grep -rn --include='*.rb' -E '\.send\(.*params' . | grep -v vendor
```

## Deserialization

### Risk

Unsafe deserialization via `Marshal.load` and `YAML.load` can lead to remote code execution. Corresponds to Brakeman's Deserialize warnings.

### Testing Patterns

```bash
# Marshal.load (Brakeman: Deserialize)
grep -rn --include='*.rb' 'Marshal\.load' . | grep -v vendor

# YAML.load (should use YAML.safe_load instead)
grep -rn --include='*.rb' 'YAML\.load\b' . | grep -v vendor | grep -v safe_load

# JSON.parse with create_additions (dangerous)
grep -rn --include='*.rb' 'create_additions' . | grep -v vendor

# Oj.load (Oj.safe_load recommended)
grep -rn --include='*.rb' 'Oj\.load' . | grep -v vendor
```

## Dependency Security

### Testing Patterns

```bash
# Vulnerability check via bundler-audit
bundle-audit check --update 2>/dev/null || echo "bundler-audit not installed"

# Static analysis via Brakeman
brakeman --no-pager 2>/dev/null || echo "brakeman not installed"

# Gems without pinned versions in Gemfile
grep -E "^gem\s+'" Gemfile 2>/dev/null | grep -v -E "(~>|>=|=\s*'[0-9])"

# Verify Gemfile.lock exists
ls -la Gemfile.lock 2>/dev/null

# Ruby version check
ruby -v 2>/dev/null
grep -E '(ruby|RUBY_VERSION)' Gemfile 2>/dev/null
```

## Brakeman Rule Mapping

| Brakeman Warning | Description | Severity |
|------------------|-------------|----------|
| SQL Injection | String concatenation in where/order/group | High |
| CrossSiteScripting | Usage of html_safe / raw | High |
| MassAssignment | Passing params directly to create/update | High |
| Execute | User input in system / backtick | High |
| Redirect | User input in redirect_to | Medium |
| Deserialize | Marshal.load / YAML.load | High |
| FileAccess | User input in file operations | High |
| ForgerySetting | Lack of CSRF protection | Medium |
| HeaderInjection | User input in headers | Medium |
| DynamicRender | User input in render | High |
| UnsafeReflection | User input in constantize / send | High |

## Ruby on Rails Security Checklist

- [ ] SQL queries use placeholders or ActiveRecord methods
- [ ] Usage of `html_safe` / `raw` is minimized and input is sanitized
- [ ] `protect_from_forgery` is set in ApplicationController
- [ ] Strong Parameters are used in all controllers
- [ ] `permit!` is not used
- [ ] Authentication filters are set on all controllers
- [ ] Authorization checks (Pundit / CanCanCan) are implemented
- [ ] File uploads have Content-Type and size restrictions
- [ ] User input is not passed directly to `redirect_to`
- [ ] Session cookies have Secure / HttpOnly flags set
- [ ] `config.force_ssl = true` is enabled in the production environment
- [ ] `config/master.key` is not tracked by Git
- [ ] `.env` files are not tracked by Git
- [ ] `Marshal.load` / `YAML.load` are not used with untrusted sources
- [ ] User input is not passed to `system` / backticks
- [ ] Zero known vulnerabilities via `bundler-audit`
- [ ] Zero Brakeman warnings at High severity or above
- [ ] Ruby / Rails versions are within the support period
