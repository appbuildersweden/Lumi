# Python Security Testing Reference

Vulnerability patterns and testing guide specific to Python (Django / FastAPI / Flask). Based on OWASP Top 10 + Bandit rules.

## SQL Injection

### Risk

Even when using an ORM, SQL Injection can occur through raw queries or SQL construction via string formatting. The main risks are Django's `extra()`, `raw()`, and direct SQL execution in FastAPI/Flask.

### Testing Patterns

```bash
# Django raw SQL (B610)
grep -rn --include='*.py' -E '\.raw\(|\.extra\(' . | grep -v venv

# SQL construction via string formatting (B608)
grep -rn --include='*.py' \
  -E "(execute\(.*(%s|%d|\.format\(|f['\"])|cursor\.execute\(.*\+)" . | grep -v venv

# String concatenation inside SQLAlchemy text()
grep -rn --include='*.py' -E 'text\(.*(\+|\.format|f["\x27])' . | grep -v venv

# Unsafe query construction in Django filter
grep -rn --include='*.py' -E '__in=.*\[.*request\.' . | grep -v venv

# Pattern of passing strings directly to ORM where clause
grep -rn --include='*.py' -E '\.filter\(.*%.*request\.' . | grep -v venv
```

## Command Injection

### Risk

Using `os.system()`, `subprocess` with shell=True, `eval()`, and `exec()` for code execution can lead to arbitrary command execution. Corresponds to Bandit B101, B301, B602, B603.

### Testing Patterns

```bash
# os.system / os.popen (B605, B606)
grep -rn --include='*.py' -E '(os\.system|os\.popen)\(' . | grep -v venv

# subprocess with shell=True (B602)
grep -rn --include='*.py' -E 'subprocess\.\w+\(.*shell\s*=\s*True' . | grep -v venv

# eval / exec (B307)
grep -rn --include='*.py' -E '\b(eval|exec)\(' . | grep -v venv

# compile + exec pattern
grep -rn --include='*.py' -E 'compile\(.*exec\(' . | grep -v venv

# Dynamic import via __import__
grep -rn --include='*.py' '__import__\(' . | grep -v venv
```

## Server-Side Template Injection (SSTI)

### Risk

When user input is passed directly to Jinja2 templates or Django templates, server-side code execution can occur.

### Testing Patterns

```bash
# Jinja2 with autoescape disabled (B701)
grep -rn --include='*.py' -E 'Environment\(.*autoescape\s*=\s*False' . | grep -v venv

# Template generated directly from string
grep -rn --include='*.py' -E '(Template\(.*request\.|render_template_string\()' . | grep -v venv

# Django mark_safe (XSS risk)
grep -rn --include='*.py' 'mark_safe\(' . | grep -v venv

# Django |safe filter
grep -rn --include='*.html' '|safe' . | grep -v venv
```

## Authentication

### Testing Patterns

```bash
# Django: Check for missing authentication decorators
grep -rn --include='*.py' -E 'def (post|put|patch|delete)\(' . | grep -v venv
# -> Verify corresponding @login_required / @permission_required exists

# Django REST Framework: Authentication class settings
grep -rn --include='*.py' -E '(authentication_classes|permission_classes)\s*=' . | grep -v venv
grep -rn --include='*.py' 'AllowAny' . | grep -v venv

# FastAPI: Authentication via Depends()
grep -rn --include='*.py' -E '@(app|router)\.(get|post|put|delete|patch)' . | grep -v venv
# -> Verify Depends(get_current_user) or similar exists

# Flask-Login: Usage of login_required
grep -rn --include='*.py' '@login_required' . | grep -v venv

# Password hashing verification
grep -rn --include='*.py' -E '(make_password|check_password|pbkdf2|bcrypt|argon2)' . | grep -v venv

# Plaintext password storage (dangerous)
grep -rn --include='*.py' -E 'password\s*=' . | grep -v venv | grep -v hash | grep -v bcrypt
```

## CSRF Protection

### Testing Patterns

```bash
# Django: Verify CSRF middleware
grep -rn --include='*.py' 'CsrfViewMiddleware' . | grep -v venv

# Django: Usage of csrf_exempt (requires review)
grep -rn --include='*.py' '@csrf_exempt' . | grep -v venv

# FastAPI: CORS settings
grep -rn --include='*.py' -E '(CORSMiddleware|allow_origins)' . | grep -v venv

# FastAPI: Wildcard origin in CORS (dangerous)
grep -rn --include='*.py' -E "allow_origins\s*=\s*\[.*['\"]?\*['\"]?" . | grep -v venv

# Flask-WTF: CSRF protection verification
grep -rn --include='*.py' -E '(CSRFProtect|csrf\.init_app)' . | grep -v venv
```

## Deserialization

### Risk

Deserialization via `pickle`, `yaml.load()`, and `marshal` can cause remote code execution. Corresponds to Bandit B301, B506.

### Testing Patterns

```bash
# Usage of pickle (B301)
grep -rn --include='*.py' -E '(pickle\.loads?|cPickle\.loads?|shelve\.open)\(' . | grep -v venv

# yaml.load without SafeLoader (B506)
grep -rn --include='*.py' 'yaml\.load\(' . | grep -v venv | grep -v SafeLoader | grep -v safe_load

# Usage of marshal (B302)
grep -rn --include='*.py' 'marshal\.loads?\(' . | grep -v venv

# jsonpickle (dangerous library)
grep -rn --include='*.py' 'jsonpickle' . | grep -v venv
```

## File Upload

### Testing Patterns

```bash
# No file extension validation
grep -rn --include='*.py' -E '(request\.files|UploadFile|FileField)' . | grep -v venv
# -> Verify allowed_extensions / content_type checks exist

# Path traversal: User input used as filename
grep -rn --include='*.py' -E '(os\.path\.join|Path)\(.*request\.' . | grep -v venv

# Django FileField upload_to setting
grep -rn --include='*.py' 'upload_to=' . | grep -v venv

# File size limit verification
grep -rn --include='*.py' -E '(MAX_UPLOAD_SIZE|FILE_UPLOAD_MAX|content_length)' . | grep -v venv
```

## Secret Management

### Testing Patterns

```bash
# Hardcoded secret keys (B105, B106, B107)
grep -rn --include='*.py' \
  -E "(SECRET_KEY|API_KEY|PASSWORD|TOKEN)\s*=\s*['\"]" . | grep -v venv | grep -v test

# .env file tracked by Git
git ls-files .env .env.local .env.production 2>/dev/null

# Secrets contained in .env
grep -iE '(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE)' .env* 2>/dev/null

# DEBUG setting in settings.py
grep -rn --include='*.py' 'DEBUG\s*=\s*True' . | grep -v venv | grep -v test

# Verify usage of python-dotenv
grep -rn --include='*.py' 'load_dotenv' . | grep -v venv
```

## Django-Specific Security Settings

### Testing Patterns

```bash
# DEBUG mode (True in production is Critical)
grep -rn 'DEBUG\s*=\s*True' --include='settings.py' . | grep -v venv

# ALLOWED_HOSTS empty or wildcard
grep -rn 'ALLOWED_HOSTS' --include='settings.py' . | grep -v venv

# Hardcoded SECRET_KEY
grep -rn 'SECRET_KEY\s*=' --include='settings.py' . | grep -v venv

# Security-related settings verification
grep -rn --include='settings.py' \
  -E '(SECURE_SSL_REDIRECT|SECURE_HSTS|SESSION_COOKIE_SECURE|CSRF_COOKIE_SECURE|SECURE_BROWSER_XSS_FILTER|X_FRAME_OPTIONS)' . | grep -v venv

# Security Middleware ordering
grep -A 20 'MIDDLEWARE' --include='settings.py' -rn . | grep -v venv
```

| Setting | Recommended Value | Risk |
|---------|-------------------|------|
| `DEBUG` | `False` | Exposure of debug information, full tracebacks |
| `ALLOWED_HOSTS` | Specific domains | Host header attacks |
| `SECRET_KEY` | Retrieved from environment variable | Session forgery, CSRF bypass |
| `SECURE_SSL_REDIRECT` | `True` | Interception of HTTP traffic |
| `SESSION_COOKIE_SECURE` | `True` | Cookie sent in plaintext |
| `CSRF_COOKIE_SECURE` | `True` | CSRF token sent in plaintext |
| `SECURE_HSTS_SECONDS` | `31536000` | HTTPS downgrade |

## FastAPI-Specific Security

### Testing Patterns

```bash
# Endpoints without authentication
grep -rn --include='*.py' -E '@(app|router)\.(get|post|put|delete)' . | grep -v venv
# -> Verify authentication checks via Depends() exist

# Pydantic model validation
grep -rn --include='*.py' -E 'class \w+\(BaseModel\)' . | grep -v venv

# Response model specification (prevent data leakage)
grep -rn --include='*.py' 'response_model=' . | grep -v venv

# CORS configuration
grep -rn --include='*.py' -A5 'CORSMiddleware' . | grep -v venv
```

## Flask-Specific Security

### Testing Patterns

```bash
# Flask debug mode (True in production is Critical)
grep -rn --include='*.py' -E '(app\.run\(.*debug\s*=\s*True|app\.debug\s*=\s*True)' . | grep -v venv

# Flask SECRET_KEY setting
grep -rn --include='*.py' "app.secret_key\s*=\s*['\"]" . | grep -v venv

# Flask session settings
grep -rn --include='*.py' -E '(SESSION_COOKIE_SECURE|SESSION_COOKIE_HTTPONLY|PERMANENT_SESSION_LIFETIME)' . | grep -v venv

# Usage of Flask-Talisman (security headers)
grep -rn --include='*.py' 'Talisman' . | grep -v venv
```

## Dependency Security

### Testing Patterns

```bash
# Known vulnerability check
pip-audit 2>/dev/null || echo "pip-audit not installed"
safety check --file requirements.txt 2>/dev/null || echo "safety not installed"

# Static analysis with Bandit
bandit -r . -ll 2>/dev/null || echo "bandit not installed"

# Dependencies without pinned versions in requirements.txt
grep -E '^[a-zA-Z]' requirements.txt 2>/dev/null | grep -v '=='

# Dependency check in setup.py / pyproject.toml
grep -A 50 'install_requires' setup.py 2>/dev/null
grep -A 50 '\[project\]' pyproject.toml 2>/dev/null | grep -A 30 'dependencies'
```

## Bandit Rule Mapping

| Bandit ID | Description | Severity |
|-----------|-------------|----------|
| B101 | Usage of assert (disabled in production) | Low |
| B105-B107 | Hardcoded passwords / secret keys | Medium |
| B301 | Usage of pickle | High |
| B302 | Usage of marshal | High |
| B307 | Usage of eval() | High |
| B501 | Disabling SSL certificate verification | High |
| B506 | Unsafe usage of yaml.load() | High |
| B602 | subprocess with shell=True | High |
| B605 | Usage of os.system() | High |
| B608 | SQL Injection (string formatting) | Medium |
| B610 | Usage of Django extra() | Medium |
| B701 | Jinja2 autoescape disabled | High |

## Python Security Checklist

- [ ] SQL queries are parameterized (no string formatting used)
- [ ] `eval()`, `exec()`, `os.system()` are not used
- [ ] `pickle.load()`, `yaml.load()` use safe loaders
- [ ] Django `DEBUG = False` is confirmed in production settings
- [ ] `ALLOWED_HOSTS` is properly configured
- [ ] `SECRET_KEY` is not hardcoded
- [ ] All endpoints have authentication and authorization checks
- [ ] CSRF protection is enabled (usage of `@csrf_exempt` is minimized)
- [ ] File uploads have extension and size restrictions
- [ ] `.env` files are not tracked by Git
- [ ] Zero known vulnerabilities via `pip-audit` / `safety`
- [ ] Zero Bandit warnings at High severity or above
- [ ] Security headers (CSP, HSTS, etc.) are configured
- [ ] FastAPI CORS settings do not use wildcard origins
- [ ] Flask debug mode is disabled in production
- [ ] Jinja2 has autoescape enabled
