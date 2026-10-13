# React Native Security Testing Reference

Security inspection guide for React Native applications. Covers cross-platform specific risks based on OWASP MASVS v2.

## Data Storage

### Inspection Targets

- **AsyncStorage**: Storing sensitive data in plaintext (no encryption)
- **react-native-keychain**: Secure storage using Keychain / KeyStore
- **MMKV**: Data encryption settings for `react-native-mmkv`
- **Realm**: Presence of Realm database encryption
- **expo-secure-store**: Secure storage in Expo environments
- **Log Output**: Sensitive data output via `console.log` / `console.warn`
- **Clipboard**: Copying sensitive data via `@react-native-clipboard/clipboard`

```bash
# Sensitive data storage in AsyncStorage
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(AsyncStorage\.(setItem|getItem|mergeItem)|@react-native-async-storage)' . | \
  grep -iE '(password|token|secret|key|credential|session|auth|pin)'

# AsyncStorage usage locations
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E 'AsyncStorage\.(setItem|multiSet|mergeItem)' .

# Verify use of react-native-keychain (recommended pattern)
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(Keychain|setGenericPassword|getGenericPassword|setInternetCredentials|react-native-keychain)' .

# Check MMKV encryption settings
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(MMKV|useMMKV|mmkvStorage|encryptionKey)' .

# Realm encryption settings
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(Realm\.open|new\s+Realm|encryptionKey|realm)' . | \
  grep -iE '(encryption|key|config)'

# Sensitive data in log output
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E 'console\.(log|warn|info|debug|error)\(' . | \
  grep -iE '(password|token|secret|key|credential|bearer|session)'

# Copying to clipboard
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(Clipboard\.setString|setStringAsync|@react-native-clipboard)' .

# Use of expo-secure-store
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(SecureStore|expo-secure-store|setItemAsync|getItemAsync)' .
```

## Network

### Inspection Targets

- **fetch / axios**: Use of HTTPS, detection of cleartext communication
- **Certificate Pinning**: Implementation of `react-native-ssl-pinning`, TrustKit
- **API Key Exposure**: Keys in request headers and URLs
- **GraphQL**: Query depth limiting, disabling Introspection
- **WebSocket**: Use of `wss://`

```bash
# Use of HTTP (non-HTTPS) URLs
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E "fetch\s*\(\s*['\`\"]http://[^l][^o][^c][^a][^l]" .

grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E "(baseURL|baseUrl|BASE_URL)\s*[:=]\s*['\`\"]http://" .

# axios configuration
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(axios\.create|axios\.(get|post|put|delete)|baseURL)' .

# Certificate Pinning implementation
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(ssl-pinning|react-native-ssl-pinning|TrustKit|certificatePinning|pinning)' .

# Hardcoded API keys
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E "(Authorization|X-Api-Key|api[_-]?key)\s*[:=]\s*['\`\"]" . | \
  grep -v 'process\.env\|Config\.\|ENV\.'

# WebSocket encryption
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E "new\s+WebSocket\s*\(\s*['\`\"]ws://" .

# GraphQL Introspection
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(__schema|__type|introspection)' .

# Android Network Security Config
find . -path '*/android/*' -name 'network_security_config.xml' \
  -exec cat {} \;

# iOS ATS settings
find . -path '*/ios/*' -name 'Info.plist' -not -path '*/Pods/*' \
  -exec grep -A 5 'NSAppTransportSecurity' {} +
```

## Code Protection

### Inspection Targets

- **Hermes Bytecode**: Verify Hermes engine is enabled
- **CodePush Security**: Signature verification for OTA updates
- **JS Bundle Protection**: Source code obfuscation
- **__DEV__ Flag**: Guarding debug-only code
- **Source Maps**: Risk of exposure in production

```bash
# Verify Hermes engine is enabled
grep -rn --include='build.gradle' --include='build.gradle.kts' \
  -E '(hermesEnabled|enableHermes)' .

# Use of __DEV__ flag
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '__DEV__' .

# Debug code outside __DEV__ guard
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E 'console\.(log|warn|debug|info)\(' . | \
  grep -v '__DEV__\|// \|test\|spec\|mock'

# CodePush configuration
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(codePush|CodePush|code-push|react-native-code-push)' .

# CodePush signature verification
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(publicKey|codePushPublicKey|CodePushPublicKey)' .

# Source map generation settings
grep -rn --include='metro.config.js' --include='metro.config.ts' \
  -E '(sourcemap|sourceMap|devtool)' .

# React Native obfuscation settings
grep -rn --include='package.json' \
  -E '(obfuscate|javascript-obfuscator|react-native-obfuscating-transformer|metro-minify)' .

# Flipper remaining in production
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(flipper|react-native-flipper|addPlugin.*Flipper)' .

grep -rn --include='*.java' --include='*.kt' \
  -E '(ReactNativeFlipper|FlipperClient|initializeFlipper)' .
```

## Native Module Security

### Inspection Targets

- **Bridge Security**: Scope of exposed Native Module methods
- **TurboModules**: Security considerations for the new architecture
- **Native Code Vulnerabilities**: Memory management, input validation
- **Third-Party Native Modules**: Trustworthiness verification

```bash
# Native Module definitions (Android)
grep -rn --include='*.java' --include='*.kt' \
  -E '(@ReactMethod|ReactContextBaseJavaModule|ReactMethod|TurboModule)' .

# Native Module definitions (iOS)
grep -rn --include='*.m' --include='*.mm' --include='*.swift' \
  -E '(RCT_EXPORT_METHOD|RCT_EXPORT_MODULE|RCTBridgeModule)' .

# Sensitive operations called from Native Modules
grep -rn --include='*.java' --include='*.kt' \
  -E '@ReactMethod' -A 5 . | \
  grep -iE '(password|token|secret|key|credential|encrypt|decrypt|auth)'

# Verify list of Native Modules
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(NativeModules\.|requireNativeComponent|TurboModuleRegistry)' .

# Check third-party Native Modules
grep -rn --include='package.json' \
  -E '"react-native-' . | head -20
```

## Authentication

### Inspection Targets

- **Biometric Authentication**: Implementation of `react-native-biometrics`, `expo-local-authentication`
- **Token Storage**: Secure storage of refresh tokens
- **Session Management**: Timeout, re-authentication when in background
- **Authentication State Management**: Protection of authentication state in Context / Redux

```bash
# Biometric authentication implementation
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(react-native-biometrics|ReactNativeBiometrics|biometricKeysExist|simplePrompt|createSignature|expo-local-authentication|authenticateAsync)' .

# Token storage method
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -iE '(access.?token|refresh.?token|auth.?token|bearer)' . | \
  grep -iE '(setItem|save|store|write|set\()'

# Session management
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(sessionTimeout|tokenExpir|refreshToken|isAuthenticated|authState)' .

# Background detection via AppState
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(AppState\.addEventListener|appState.*background|appStateChange)' .
```

## Deep Linking

### Inspection Targets

- **URL Schemes**: Input validation for custom schemes
- **Universal Links / App Links**: Domain verification settings
- **Parameter Validation**: Sanitization of Deep Link parameters
- **Navigation**: Access control for dynamic routing

```bash
# Deep Link configuration (React Navigation)
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(linking|deepLink|Linking\.addEventListener|Linking\.getInitialURL|useURL|createURL)' .

# URL scheme definitions
grep -rn --include='AndroidManifest.xml' \
  -E '(android:scheme|android:host|android:pathPrefix)' .

find . -path '*/ios/*' -name 'Info.plist' -not -path '*/Pods/*' \
  -exec grep -A 3 'CFBundleURLSchemes' {} +

# Deep Link parameter usage
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(Linking\.parse|url\.parse|useRoute|route\.params|getInitialURL)' .

# Navigation access control
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(PrivateRoute|AuthNavigator|isAuthenticated.*navigate|beforeRemove|useAuth)' .

# Universal Links apple-app-site-association
find . -name 'apple-app-site-association' -o -name 'assetlinks.json' | head -5
```

## Debug / Release

### Inspection Targets

- **__DEV__ Flag**: Separation of development-only code
- **Debug Detection**: Disabling debug features in Release builds
- **Flipper**: Removal of Flipper from production builds
- **React DevTools**: Disabling DevTools in production
- **LogBox**: Disabling error overlays

```bash
# Check debug-only code
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E 'if\s*\(\s*__DEV__\s*\)' .

# Remaining console statements (recommended to remove in Release)
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -c 'console\.(log|warn|debug|info|error)\(' . | \
  grep -v ':0$' | sort -t: -k2 -nr | head -10

# Check for remaining Flipper
grep -rn --include='package.json' \
  -E 'react-native-flipper' .

# babel-plugin-transform-remove-console configuration
grep -rn --include='babel.config.js' --include='babel.config.ts' --include='.babelrc' \
  -E '(transform-remove-console|remove-console)' .

# Check android:debuggable
grep -rn --include='AndroidManifest.xml' \
  -E 'android:debuggable\s*=\s*"true"' .

# Disabling React DevTools
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(connectToDevTools|DevTools|reactDevTools)' .

# LogBox configuration
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(LogBox\.ignoreLogs|LogBox\.ignoreAllLogs)' .
```

## Dependency Security

### Inspection Targets

- **npm audit**: Vulnerabilities in JavaScript dependencies
- **Native Dependencies**: Security of CocoaPods / Gradle
- **Supply Chain**: Detection of malicious packages
- **Version Pinning**: Lock file management

```bash
# Run npm audit
npm audit --json 2>/dev/null | head -50

# Check for package-lock.json / yarn.lock existence
ls -la package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null

# Check total number of dependencies
grep -c '"react-native' package.json 2>/dev/null

# Check postinstall scripts (supply chain attack risk)
grep -rn --include='package.json' \
  -E '"(preinstall|postinstall|prepare|prepublish)"' .

# Check native dependencies (CocoaPods)
find . -path '*/ios/*' -name 'Podfile.lock' | head -3

# Check native dependencies (Gradle)
find . -path '*/android/*' -name 'build.gradle' | \
  xargs grep -E 'implementation|api\s' 2>/dev/null | head -20

# Detection of unofficial registries
grep -rn -E '(registry\s*[:=]|@.*:registry)' .npmrc .yarnrc .yarnrc.yml 2>/dev/null

# Check Expo configuration
grep -rn --include='app.json' --include='app.config.js' --include='app.config.ts' \
  -E '(expo|plugins|scheme|permissions)' . | head -20
```

## Environment Variables and Secrets

### Inspection Targets

- **Hardcoded Secrets**: API keys, tokens, passwords
- **.env Files**: Use of `react-native-config`, `react-native-dotenv`
- **app.json / app.config.js**: Secrets in Expo configuration
- **.gitignore**: Verification that sensitive files are excluded

```bash
# Hardcoded API keys and secrets
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E "(const|let|var)\s+\w*(apiKey|apiSecret|appKey|appSecret|clientSecret|secretKey|privateKey)\s*=\s*['\`\"][^'\`\"]+['\`\"]" .

# Check .env files
find . -maxdepth 2 -name '.env' -o -name '.env.*' | head -10
grep -n '\.env' .gitignore 2>/dev/null

# Use of react-native-config
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(react-native-config|Config\.\w+|import\s+Config\s+from)' .

# Google Services files
find . -name 'google-services.json' -o -name 'GoogleService-Info.plist' | head -5

# Hardcoded Firebase configuration
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(apiKey|authDomain|databaseURL|projectId|storageBucket|messagingSenderId|appId)\s*[:=]' . | \
  grep -v 'process\.env\|Config\.\|ENV\.\|@type\|interface\|type '

# Sentry DSN exposure
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '(SENTRY_DSN|dsn.*sentry|sentry\.io)' .
```

## React Native Inspection Checklist

- [ ] Sensitive data is not stored in AsyncStorage (use `react-native-keychain`)
- [ ] Sensitive data is not output in logs (remove console statements in Release)
- [ ] `babel-plugin-transform-remove-console` is configured
- [ ] Only HTTPS is used and no HTTP communication exists
- [ ] Certificate Pinning is implemented
- [ ] API keys are not hardcoded in source code
- [ ] `.env` files are included in `.gitignore`
- [ ] `google-services.json` / `GoogleService-Info.plist` are properly managed
- [ ] Hermes engine is enabled (protection through bytecode compilation)
- [ ] When using CodePush, signature verification is enabled
- [ ] Debug code is properly guarded with `__DEV__`
- [ ] Flipper is removed from production builds
- [ ] `android:debuggable="false"` is configured
- [ ] Native Module methods are minimally exposed
- [ ] Deep Link parameters are validated and sanitized
- [ ] Biometric authentication is properly implemented (`react-native-biometrics`)
- [ ] Tokens are stored in Keychain / KeyStore
- [ ] No vulnerable dependencies detected by `npm audit`
- [ ] `postinstall` scripts have been verified as safe
- [ ] Lock files (package-lock.json / yarn.lock) are committed
- [ ] Android Network Security Config is properly configured
- [ ] iOS ATS (App Transport Security) is enabled
- [ ] WebSocket uses `wss://`
- [ ] Source maps are not exposed in production
