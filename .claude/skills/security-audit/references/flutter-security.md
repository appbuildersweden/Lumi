# Flutter Security Testing Reference

Security inspection guide for Flutter/Dart applications. Covers cross-platform specific risks based on OWASP MASVS v2.

## Data Storage

### Inspection Targets

- **SharedPreferences**: Storing sensitive data in plaintext (`shared_preferences` package)
- **flutter_secure_storage**: Recommended encrypted storage using Keychain / KeyStore
- **sqflite**: Presence of SQLite database encryption
- **Hive / Isar**: Storing sensitive data in local databases
- **File Storage**: Protection of temporary/persistent files via `path_provider`
- **Log Output**: Sensitive data output via `print` / `debugPrint` / `log`
- **Clipboard**: Copying sensitive data via `Clipboard.setData`

```bash
# Sensitive data storage in SharedPreferences
grep -rn --include='*.dart' \
  -E '(SharedPreferences|\.setString|\.setInt|\.setBool)' . | \
  grep -iE '(password|token|secret|key|credential|session|auth|pin)'

# Verify use of flutter_secure_storage (recommended pattern)
grep -rn --include='*.dart' \
  -E '(FlutterSecureStorage|secureStorage|\.write\(key:|\.read\(key:)' .

# Check sqflite usage and encryption
grep -rn --include='*.dart' \
  -E '(openDatabase|getDatabasesPath|sqflite|sqflite_sqlcipher)' .

# sqflite / sqlcipher dependencies in pubspec.yaml
grep -n -E '(sqflite|sqflite_sqlcipher|flutter_secure_storage|hive|isar)' pubspec.yaml

# Sensitive data in log output
grep -rn --include='*.dart' \
  -E '(print\(|debugPrint\(|log\(|logger\.)' . | \
  grep -iE '(password|token|secret|key|credential|bearer|session)'

# File storage
grep -rn --include='*.dart' \
  -E '(File\(|writeAsString|writeAsBytes|getTemporaryDirectory|getApplicationDocumentsDirectory)' .

# Copying to clipboard
grep -rn --include='*.dart' \
  -E '(Clipboard\.setData|ClipboardData)' .
```

## Cryptography

### Inspection Targets

- **Weak Algorithms**: MD5, SHA1 (for signature purposes), DES, RC4
- **pointycastle / encrypt**: Proper use of cryptographic packages
- **Hardcoded Keys**: Cryptographic keys, IVs, and salts in Dart code
- **Random Number Generation**: Use of `Random()` for cryptographic purposes (`Random.secure()` recommended)
- **Key Management**: Secure generation and storage of keys

```bash
# Weak cryptographic algorithms
grep -rn --include='*.dart' \
  -iE '(md5|sha1|MD5|SHA1|DES|RC4|\.convert\(.*md5|\.convert\(.*sha1)' .

# Hardcoded cryptographic keys
grep -rn --include='*.dart' \
  -E "(const|final|var)\s+(key|secret|iv|nonce|salt|aesKey|encryptionKey)\s*=\s*['\"][^'\"]{8,}['\"]" .

# Use of cryptographic packages
grep -rn --include='*.dart' \
  -E '(import.*pointycastle|import.*encrypt|import.*crypto|AES|RSA|Encrypter|IV\.fromLength)' .

# Insecure random number generation
grep -rn --include='*.dart' \
  -E 'Random\(\)' . | grep -v 'Random\.secure'

# Cryptography-related dependencies in pubspec.yaml
grep -n -E '(pointycastle|encrypt|crypto|cryptography)' pubspec.yaml
```

## Network

### Inspection Targets

- **http / dio Packages**: Use of HTTPS, detection of cleartext communication
- **Certificate Pinning**: Pinning via `SecurityContext` or dio interceptors
- **Proxy Detection**: Countermeasures against man-in-the-middle attacks
- **API Key Exposure**: Keys in request headers and URL parameters
- **badCertificateCallback**: Disabling certificate verification

```bash
# Use of HTTP (non-HTTPS) URLs
grep -rn --include='*.dart' \
  -E "http://[^l][^o][^c][^a][^l]" . | grep -v '// '

# Use of dio / http packages
grep -rn --include='*.dart' \
  -E '(import.*package:dio|import.*package:http/|Dio\(|http\.Client|HttpClient)' .

# Disabling certificate verification (returning true in badCertificateCallback = dangerous)
grep -rn --include='*.dart' \
  -E '(badCertificateCallback|onBadCertificate)' .

# Certificate Pinning implementation
grep -rn --include='*.dart' \
  -E '(SecurityContext|setTrustedCertificates|clientCertificate|certificatePinning)' .

# API key embedding in headers
grep -rn --include='*.dart' \
  -E "(headers|Header).*['\"]?(Authorization|X-Api-Key|api[_-]?key)['\"]?" . | \
  grep -v 'TODO\|FIXME'

# Proxy settings
grep -rn --include='*.dart' \
  -E '(findProxy|HttpClient\..*proxy|PROXY|badCertificateCallback.*true)' .

# Android Network Security Config reference
find . -path '*/android/*' -name 'network_security_config.xml' \
  -exec cat {} \;

# iOS ATS settings
find . -path '*/ios/*' -name 'Info.plist' -not -path '*/Pods/*' \
  -exec grep -A 5 'NSAppTransportSecurity' {} +
```

## Platform Channel Security

### Inspection Targets

- **MethodChannel**: Validation of communication content with native code
- **EventChannel**: Sensitivity of stream data
- **BasicMessageChannel**: Message encryption and validation
- **Native Code Injection**: Hardcoded channel names and spoofing risk
- **Data Serialization**: Type safety of data passed through channels

```bash
# MethodChannel definitions
grep -rn --include='*.dart' \
  -E '(MethodChannel|EventChannel|BasicMessageChannel)\s*\(' .

# Hardcoded channel names
grep -rn --include='*.dart' \
  -E "(MethodChannel|EventChannel)\s*\(\s*['\"]" .

# Native-side channel implementation (Kotlin)
grep -rn --include='*.kt' \
  -E '(MethodChannel|FlutterMethodChannel|setMethodCallHandler)' .

# Native-side channel implementation (Swift)
grep -rn --include='*.swift' \
  -E '(FlutterMethodChannel|FlutterEventChannel|FlutterBasicMessageChannel)' .

# Sensitive data through channels
grep -rn --include='*.dart' \
  -E 'invokeMethod.*' . | \
  grep -iE '(password|token|secret|key|credential|auth)'
```

## Code Protection

### Inspection Targets

- **Obfuscation**: Use of `--obfuscate` flag and `--split-debug-info`
- **Debug Mode Detection**: Use of `kDebugMode` / `kReleaseMode` / `kProfileMode`
- **Assert Statements**: Confirm assert behavior in Release builds
- **Remaining Debug Code**: Remaining `debugPrint`, `print`, `developer.log`
- **Source Maps**: Risk of exposing debug information in production

```bash
# Verify obfuscation settings (build command)
find . -name 'Makefile' -o -name '*.sh' -o -name '*.yaml' -o -name '*.yml' | \
  xargs grep -l 'obfuscate\|split-debug-info' 2>/dev/null

# Debug mode detection
grep -rn --include='*.dart' \
  -E '(kDebugMode|kReleaseMode|kProfileMode|Foundation\.kDebugMode)' .

# Verify debug-only code is guarded
grep -rn --include='*.dart' -B 1 \
  -E '(print\(|debugPrint\(|developer\.log\()' . | \
  grep -v 'kDebugMode\|assert\|// '

# Check assert statements
grep -rn --include='*.dart' \
  -E '^\s*assert\(' .

# Dart DevTools / Observatory settings
grep -rn --include='*.dart' \
  -E '(DevTools|Observatory|debugger\(\)|developer\.)' .
```

## WebView Security

### Inspection Targets

- **webview_flutter**: JavaScript enable settings
- **JavaScriptChannel**: Input validation for native bridge
- **NavigationDelegate**: URL filtering implementation
- **Local File Access**: Control of file:// scheme

```bash
# WebView JavaScript enabled
grep -rn --include='*.dart' \
  -E '(JavascriptMode\.unrestricted|javaScriptMode.*JavaScriptMode\.unrestricted|WebView\(|WebViewController|InAppWebView)' .

# JavaScriptChannel definitions
grep -rn --include='*.dart' \
  -E '(JavascriptChannel|JavaScriptChannel|addJavaScriptChannel|onMessageReceived)' .

# NavigationDelegate filtering
grep -rn --include='*.dart' \
  -E '(NavigationDelegate|navigationDelegate|onNavigationRequest|setNavigationDelegate)' .

# Local file loading in WebView
grep -rn --include='*.dart' \
  -E '(loadFile|loadFlutterAsset|file://|loadHtmlString)' .

# WebView dependencies in pubspec.yaml
grep -n -E '(webview_flutter|flutter_inappwebview|flutter_webview_plugin)' pubspec.yaml
```

## State Management and Memory

### Inspection Targets

- **Sensitive Data in State**: Managing sensitive data in Provider / Riverpod / BLoC
- **Memory Cleanup**: Clearing sensitive data on dispose
- **Global State**: Holding sensitive data in singletons or global variables
- **Screenshot Protection**: Data protection on background transition

```bash
# Sensitive data in State
grep -rn --include='*.dart' \
  -E '(StateNotifier|ChangeNotifier|BlocProvider|Cubit|Provider)' . | \
  grep -iE '(password|token|secret|credential|auth)'

# Verify dispose method implementation
grep -rn --include='*.dart' \
  -E '(void\s+dispose\(\)|@override.*dispose)' .

# Sensitive data in global variables
grep -rn --include='*.dart' \
  -E '^(final|var|late)\s+\w*(token|secret|password|key|credential)' .

# WidgetsBindingObserver (lifecycle monitoring)
grep -rn --include='*.dart' \
  -E '(WidgetsBindingObserver|didChangeAppLifecycleState|AppLifecycleState)' .
```

## Build Security

### Inspection Targets

- **API Keys Embedded in Dart Code**: Secrets in source code
- **.env Files**: Use of `flutter_dotenv` and `.gitignore` configuration
- **--dart-define**: Environment variable injection at build time
- **Asset Files**: Sensitive files in the `assets/` directory
- **pubspec.yaml**: Detection of unnecessary or outdated dependencies

```bash
# API keys and secrets in Dart code
grep -rn --include='*.dart' \
  -E "(const|final)\s+\w*(apiKey|apiSecret|appKey|appSecret|clientSecret|secretKey)\s*=\s*['\"][^'\"]+['\"]" .

# Check for .env files and .gitignore configuration
find . -name '.env' -o -name '.env.*' -o -name 'env.dart' | head -10
grep -n '\.env' .gitignore 2>/dev/null

# Use of flutter_dotenv
grep -rn --include='*.dart' \
  -E '(dotenv|DotEnv|flutter_dotenv|env\.get|env\[)' .

# Verify use of --dart-define
find . -name 'Makefile' -o -name '*.sh' -o -name '*.yaml' | \
  xargs grep -l 'dart-define\|dart-define-from-file' 2>/dev/null

# Sensitive files in asset directories
find . -path '*/assets/*' \
  -iname '*.pem' -o -iname '*.key' -o -iname '*.p12' -o -iname '*.json' | \
  grep -iE '(key|secret|credential|service.account|google.services)'

# Detection of outdated dependencies
grep -rn --include='pubspec.yaml' \
  -E '^\s+\w+:\s*\^?\d' . | head -20

# Android google-services.json
find . -path '*/android/*' -name 'google-services.json' | head -5

# iOS GoogleService-Info.plist
find . -path '*/ios/*' -name 'GoogleService-Info.plist' | head -5
```

## Flutter Inspection Checklist

- [ ] Sensitive data is not stored in plaintext in SharedPreferences (use `flutter_secure_storage`)
- [ ] Encryption is enabled for sqflite (use `sqflite_sqlcipher`)
- [ ] Sensitive data is not output in logs (`print` disabled in Release builds)
- [ ] Only HTTPS is used and no HTTP communication exists
- [ ] `badCertificateCallback` does not disable certificate verification in production
- [ ] Certificate Pinning is implemented
- [ ] API keys are not hardcoded in Dart code (use `--dart-define`)
- [ ] `.env` files are included in `.gitignore`
- [ ] `--obfuscate` and `--split-debug-info` are used in Release builds
- [ ] Debug code is properly guarded with `kDebugMode`
- [ ] `JavascriptMode.unrestricted` is used minimally in WebView
- [ ] JavaScriptChannel input is validated and sanitized
- [ ] Data passed through Platform Channels is validated
- [ ] Sensitive data in State / Provider is cleared on dispose
- [ ] `Random.secure()` is used for cryptographic purposes
- [ ] Weak cryptographic algorithms (MD5, SHA1, DES) are not used
- [ ] Cleartext is prohibited in Android's `network_security_config.xml`
- [ ] iOS ATS (App Transport Security) is enabled
- [ ] `google-services.json` / `GoogleService-Info.plist` are properly managed
- [ ] Unnecessary permissions have been removed from `AndroidManifest.xml` / `Info.plist`
