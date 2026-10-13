# Android Security Testing Reference

Detailed inspection guide for Kotlin/Java based on OWASP MASVS v2 / MASTG.

## MASVS-STORAGE: Data Storage

### Inspection Targets

- **SharedPreferences**: Prohibition of storing sensitive data (tokens, passwords, personal information) in plaintext
- **EncryptedSharedPreferences**: Recommended use of encrypted SharedPreferences
- **SQLite**: Presence of encryption (use of SQLCipher), protection of WAL files
- **Internal Storage**: Prohibition of using `MODE_WORLD_READABLE` / `MODE_WORLD_WRITABLE`
- **External Storage**: Prohibition of writing sensitive data to external storage such as SD cards
- **Log Output**: Sensitive data output via `Log.d` / `Log.v` / `Log.i`
- **Clipboard**: Copying sensitive data to `ClipboardManager`
- **Backup**: Data leakage risk from `android:allowBackup="true"`

```bash
# Sensitive data storage in SharedPreferences
grep -rn --include='*.kt' --include='*.java' \
  -E '(getSharedPreferences|PreferenceManager\.getDefaultSharedPreferences)' . | \
  grep -iE '(password|token|secret|key|credential|session|auth|pin)'

# Verify use of EncryptedSharedPreferences (recommended pattern)
grep -rn --include='*.kt' --include='*.java' \
  -E 'EncryptedSharedPreferences' .

# Check SharedPreferences MODE (WORLD_READABLE / WORLD_WRITABLE is dangerous)
grep -rn --include='*.kt' --include='*.java' \
  -E 'MODE_WORLD_(READABLE|WRITABLE)' .

# Writing to external storage
grep -rn --include='*.kt' --include='*.java' \
  -E '(getExternalStorageDirectory|getExternalFilesDir|Environment\.DIRECTORY_)' .

# Sensitive data in log output
grep -rn --include='*.kt' --include='*.java' \
  -E 'Log\.(d|v|i|w|e|wtf)\(' . | \
  grep -iE '(password|token|secret|key|credential|bearer|session)'

# Plaintext SQLite database
grep -rn --include='*.kt' --include='*.java' \
  -E '(SQLiteDatabase\.openOrCreateDatabase|openOrCreateDatabase|SQLiteOpenHelper)' .

# Copying to clipboard
grep -rn --include='*.kt' --include='*.java' \
  -E '(ClipboardManager|setPrimaryClip|ClipData\.newPlainText)' .

# android:allowBackup setting
grep -rn --include='AndroidManifest.xml' \
  -E 'android:allowBackup\s*=\s*"true"' .
```

## MASVS-CRYPTO: Cryptography

### Inspection Targets

- **Weak Algorithms**: MD5, SHA1 (for signature purposes), DES, 3DES, RC4, ECB mode
- **Android KeyStore**: Proper key storage and access control
- **Hardcoded Keys**: Cryptographic keys and IVs in source code
- **Random Number Generation**: Use of `java.util.Random` for cryptographic purposes (`SecureRandom` recommended)
- **Key Derivation Functions**: Proper use of PBKDF2, Argon2

```bash
# Weak cryptographic algorithms
grep -rn --include='*.kt' --include='*.java' \
  -iE '(getInstance\s*\(\s*"(DES|DESede|RC4|RC2|Blowfish|MD5|SHA-1)"|AES/ECB|DES/ECB)' .

# Use of ECB mode (pattern leakage risk)
grep -rn --include='*.kt' --include='*.java' \
  -E 'Cipher\.getInstance\s*\(\s*"[^"]*ECB' .

# Hardcoded cryptographic keys
grep -rn --include='*.kt' --include='*.java' \
  -E '(val|var|final|static)\s+(key|secret|iv|nonce|aesKey|secretKey)\s*[:=]\s*"[^"]{8,}"' .

# Use of java.util.Random for cryptographic purposes (SecureRandom recommended)
grep -rn --include='*.kt' --include='*.java' \
  -E 'java\.util\.Random|new\s+Random\(' .

# Verify use of Android KeyStore
grep -rn --include='*.kt' --include='*.java' \
  -E '(KeyStore\.getInstance\s*\(\s*"AndroidKeyStore"|KeyGenParameterSpec|setUserAuthenticationRequired)' .

# Weak hash algorithms
grep -rn --include='*.kt' --include='*.java' \
  -E 'MessageDigest\.getInstance\s*\(\s*"(MD5|SHA-1)"\)' .
```

## MASVS-AUTH: Authentication

### Inspection Targets

- **BiometricPrompt**: Proper biometric authentication implementation and use of CryptoObject
- **Local Authentication**: Safety of biometric fallback (device credentials)
- **Token Management**: Storing access tokens and refresh tokens in KeyStore
- **Session Control**: Timeout, re-authentication when in background
- **CryptoObject**: Binding biometric authentication to cryptographic operations (preventing authentication bypass)

```bash
# BiometricPrompt implementation
grep -rn --include='*.kt' --include='*.java' \
  -E '(BiometricPrompt|BiometricManager|canAuthenticate|authenticate\s*\()' .

# Verify use of CryptoObject (not using it poses authentication bypass risk)
grep -rn --include='*.kt' --include='*.java' \
  -E '(CryptoObject|BiometricPrompt\.CryptoObject)' .

# Biometric fallback settings
grep -rn --include='*.kt' --include='*.java' \
  -E '(setAllowedAuthenticators|BIOMETRIC_STRONG|BIOMETRIC_WEAK|DEVICE_CREDENTIAL)' .

# FingerprintManager (detection of deprecated API)
grep -rn --include='*.kt' --include='*.java' \
  -E '(FingerprintManager|FingerprintManagerCompat)' .

# Token storage locations
grep -rn --include='*.kt' --include='*.java' \
  -iE '(access_token|refresh_token|auth_token|bearer)' . | \
  grep -iE '(put|save|store|write|edit\(\))'
```

## MASVS-NETWORK: Network

### Inspection Targets

- **Network Security Config**: Settings in `network_security_config.xml`
- **Cleartext Communication**: Enabling `cleartextTrafficPermitted`
- **Certificate Pinning**: Pinning implementation (OkHttp CertificatePinner, Network Security Config)
- **Custom TrustManager**: `X509TrustManager` accepting all certificates
- **HostnameVerifier**: Disabling hostname verification

```bash
# Check Network Security Config
find . -name 'network_security_config.xml' \
  -exec cat {} \;

# Allowing cleartext communication
grep -rn --include='AndroidManifest.xml' \
  -E '(usesCleartextTraffic\s*=\s*"true"|cleartextTrafficPermitted\s*=\s*"true")' .

grep -rn --include='network_security_config.xml' \
  -E 'cleartextTrafficPermitted\s*=\s*"true"' .

# Custom TrustManager (accepting all certificates = dangerous)
grep -rn --include='*.kt' --include='*.java' \
  -E '(X509TrustManager|TrustManager|checkServerTrusted|getAcceptedIssuers)' .

# Disabling HostnameVerifier (allowing all hostnames = dangerous)
grep -rn --include='*.kt' --include='*.java' \
  -E '(ALLOW_ALL_HOSTNAME_VERIFIER|HostnameVerifier\s*\{|verify.*return\s+true)' .

# OkHttp Certificate Pinning
grep -rn --include='*.kt' --include='*.java' \
  -E '(CertificatePinner|certificatePinner|\.pin\s*\()' .

# Use of HTTP URLs (cleartext)
grep -rn --include='*.kt' --include='*.java' \
  -E '"http://[^l][^o][^c][^a][^l]' . | grep -v '// '

# Network Security Config reference
grep -rn --include='AndroidManifest.xml' \
  -E 'networkSecurityConfig' .
```

## MASVS-PLATFORM: Platform Interaction

### Inspection Targets

- **Intent Filters**: Receiving implicit Intents, input validation
- **Deep Links / App Links**: Insufficient validation of URL parameters
- **WebView**: `setJavaScriptEnabled`, `addJavascriptInterface`, `setAllowFileAccess`
- **Content Provider**: Providers with `exported="true"` and permission control
- **Broadcast Receiver**: Receivers with `exported="true"` and permissions
- **PendingIntent**: Proper use of `FLAG_IMMUTABLE` / `FLAG_MUTABLE`
- **Activity / Service Export**: Exposing unnecessary components

```bash
# Check exported components
grep -rn --include='AndroidManifest.xml' \
  -E 'android:exported\s*=\s*"true"' .

# Components with Intent filters
grep -rn --include='AndroidManifest.xml' -A 5 \
  '<intent-filter>' .

# Deep Link definitions
grep -rn --include='AndroidManifest.xml' \
  -E '(android:scheme|android:host|android:pathPrefix)' .

# Unvalidated use of Intent data
grep -rn --include='*.kt' --include='*.java' \
  -E '(getIntent\(\)|intent\.(getStringExtra|getData|getAction|getExtras))' .

# Dangerous WebView settings
grep -rn --include='*.kt' --include='*.java' \
  -E '(setJavaScriptEnabled\s*\(\s*true|addJavascriptInterface|setAllowFileAccess\s*\(\s*true|setAllowFileAccessFromFileURLs|setAllowUniversalAccessFromFileURLs)' .

# Content Provider export
grep -rn --include='AndroidManifest.xml' -B 2 -A 5 \
  '<provider' . | grep -E '(exported|authorities|permission|readPermission|writePermission)'

# PendingIntent flag check (FLAG_MUTABLE can be dangerous)
grep -rn --include='*.kt' --include='*.java' \
  -E '(PendingIntent\.(getActivity|getBroadcast|getService|getForegroundService)|FLAG_MUTABLE|FLAG_IMMUTABLE)' .

# Broadcast Receiver permissions
grep -rn --include='*.kt' --include='*.java' \
  -E '(registerReceiver|sendBroadcast|sendOrderedBroadcast)' .
```

## MASVS-CODE: Code Quality

### Inspection Targets

- **ProGuard/R8**: Verify obfuscation settings (`minifyEnabled`, `proguard-rules.pro`)
- **Debug Flag**: `android:debuggable="true"` remaining in production
- **StrictMode**: Enabled in production builds
- **Dependency Libraries**: Libraries containing known vulnerabilities
- **Input Validation**: Sanitization of external inputs (Intent, Deep Link, Content Provider)
- **WebView Remote Debugging**: `setWebContentsDebuggingEnabled(true)` remaining in code

```bash
# ProGuard/R8 settings
grep -rn --include='build.gradle' --include='build.gradle.kts' \
  -E '(minifyEnabled|isMinifyEnabled|proguardFiles|shrinkResources)' .

# Remaining debug flags
grep -rn --include='AndroidManifest.xml' \
  -E 'android:debuggable\s*=\s*"true"' .

# StrictMode remaining in production
grep -rn --include='*.kt' --include='*.java' \
  -E '(StrictMode\.setThreadPolicy|StrictMode\.setVmPolicy|StrictMode\.ThreadPolicy)' .

# WebView remote debugging enabled
grep -rn --include='*.kt' --include='*.java' \
  -E 'setWebContentsDebuggingEnabled\s*\(\s*true' .

# Remaining debug logs
grep -rn --include='*.kt' --include='*.java' \
  -E '(BuildConfig\.DEBUG|isDebuggable|debuggable)' . | \
  grep -v 'if.*BuildConfig\.DEBUG'

# Check Gradle dependencies for vulnerabilities
find . -name 'build.gradle' -o -name 'build.gradle.kts' | \
  head -5 | xargs grep -E 'implementation|api|compileOnly' 2>/dev/null
```

## MASVS-RESILIENCE: Tamper Resistance

### Inspection Targets

- **Root Detection**: Libraries such as RootBeer, manual detection logic
- **Tamper Detection**: APK signature verification, installer package verification
- **Emulator Detection**: Build property checks, sensor availability checks
- **Debugger Detection**: `isDebuggerConnected()`, TracerPid verification
- **Frida Detection**: Detection of Frida server ports and processes
- **Reverse Engineering Countermeasures**: String obfuscation, reflection countermeasures

```bash
# Root detection implementation
grep -rn --include='*.kt' --include='*.java' \
  -iE '(isRooted|rootBeer|RootTools|checkForSuBinary|/system/app/Superuser|/system/xbin/su|com\.topjohnwu\.magisk)' .

# Emulator detection
grep -rn --include='*.kt' --include='*.java' \
  -iE '(isEmulator|Build\.(FINGERPRINT|MODEL|MANUFACTURER|BRAND|DEVICE|PRODUCT).*generic|goldfish|ranchu|sdk_gphone|google_sdk)' .

# Debugger detection
grep -rn --include='*.kt' --include='*.java' \
  -E '(Debug\.isDebuggerConnected|waitForDebugger|TracerPid|android\.os\.Debug)' .

# Frida detection
grep -rn --include='*.kt' --include='*.java' \
  -iE '(frida|27042|fridaserver|libfrida|xposed|de\.robv\.android\.xposed)' .

# APK signature verification
grep -rn --include='*.kt' --include='*.java' \
  -E '(PackageManager\.GET_SIGNATURES|GET_SIGNING_CERTIFICATES|PackageInfo.*signatures|getPackageInfo)' .

# Installer package verification (sideloading detection)
grep -rn --include='*.kt' --include='*.java' \
  -E '(getInstallerPackageName|getInstallSourceInfo|com\.android\.vending)' .
```

## MASVS-PRIVACY: Privacy

### Inspection Targets

- **Android Permissions**: Requesting unnecessary dangerous permissions (`DANGEROUS` level)
- **Location Information**: Foreground/background location access, minimizing accuracy
- **Advertising ID**: Use of Google Advertising ID and alternatives
- **Data Collection**: Usage of analytics SDKs and trackers
- **Privacy Indicators**: Indicator support when camera or microphone is in use

```bash
# Requesting dangerous permissions
grep -rn --include='AndroidManifest.xml' \
  -E '(READ_CONTACTS|READ_CALL_LOG|READ_SMS|RECORD_AUDIO|CAMERA|ACCESS_FINE_LOCATION|ACCESS_BACKGROUND_LOCATION|READ_EXTERNAL_STORAGE|READ_MEDIA_IMAGES|READ_PHONE_STATE|BODY_SENSORS)' .

# Use of location information
grep -rn --include='*.kt' --include='*.java' \
  -E '(LocationManager|FusedLocationProviderClient|requestLocationUpdates|getLastKnownLocation|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)' .

# Background location access
grep -rn --include='AndroidManifest.xml' \
  -E 'ACCESS_BACKGROUND_LOCATION' .

# Use of advertising ID
grep -rn --include='*.kt' --include='*.java' \
  -E '(AdvertisingIdClient|getAdvertisingIdInfo|advertisingId)' .

# Detection of analytics SDKs
grep -rn --include='build.gradle' --include='build.gradle.kts' \
  -iE '(firebase-analytics|com\.google\.firebase|com\.facebook\.android|com\.adjust\.sdk|io\.branch|com\.appsflyer)' .

# Use of camera and microphone
grep -rn --include='*.kt' --include='*.java' \
  -E '(CameraManager|Camera\.open|MediaRecorder|AudioRecord)' .
```

## Android Inspection Checklist

- [ ] Sensitive data is not stored in plaintext in SharedPreferences (use EncryptedSharedPreferences)
- [ ] Sensitive data is not written to external storage
- [ ] `android:allowBackup="false"` is configured
- [ ] Sensitive data is not output in logs (logging disabled in Release builds)
- [ ] Network Security Config is properly configured
- [ ] `cleartextTrafficPermitted` is set to false
- [ ] Certificate Pinning is implemented
- [ ] Custom TrustManager does not accept all certificates
- [ ] HostnameVerifier correctly verifies hostnames
- [ ] Unnecessary components are set to `exported="false"`
- [ ] Intent data is validated and sanitized
- [ ] `addJavascriptInterface` is used minimally in WebView
- [ ] WebView remote debugging is disabled in production
- [ ] Content Provider has appropriate permissions configured
- [ ] `FLAG_IMMUTABLE` is used for PendingIntent
- [ ] CryptoObject is used with BiometricPrompt
- [ ] Weak cryptographic algorithms (MD5, SHA1, DES, ECB mode) are not used
- [ ] Cryptographic keys are not hardcoded (use Android KeyStore)
- [ ] `SecureRandom` is used for cryptographic purposes
- [ ] Obfuscation via ProGuard/R8 is enabled
- [ ] `android:debuggable="false"` is configured
- [ ] Root detection is implemented (for high-security apps)
- [ ] Unnecessary dangerous permissions are not requested
- [ ] Background location access is minimized
