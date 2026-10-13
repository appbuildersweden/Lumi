# iOS Security Testing Reference

Detailed testing guide based on OWASP MASVS v2 / MASTG.

## MASVS-STORAGE: Data Storage

### Inspection Targets

- **NSUserDefaults**: Storing sensitive data (tokens, passwords, personal information) is prohibited
- **Keychain**: Appropriateness of access attributes (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` recommended)
- **SQLite/Realm/Core Data**: Presence of encryption, protection of WAL files
- **File system**: Data Protection class configuration
- **Clipboard**: Copying sensitive data to `UIPasteboard.general`
- **Backup exclusion**: Excluding sensitive files from iTunes/iCloud backups
- **Log output**: Sensitive data output via `NSLog` / `os_log` / `print`
- **Snapshots**: Screenshot protection during background transitions

```bash
# Sensitive data stored in NSUserDefaults
grep -rn --include='*.swift' \
  -E 'UserDefaults\.(standard|suite)' . | \
  grep -iE '(password|token|secret|key|credential|session|auth)'

# Keychain access attributes
grep -rn --include='*.swift' --include='*.m' \
  -E 'kSecAttrAccessible' .

# Sensitive data in log output
grep -rn --include='*.swift' \
  -E '(NSLog|os_log|print|debugPrint)\(.*' . | \
  grep -iE '(password|token|secret|key|credential|bearer)'

# Data Protection class
grep -rn --include='*.swift' --include='*.m' \
  -E '(NSFileProtection|FileProtectionType)' .

# Clipboard usage
grep -rn --include='*.swift' \
  -E 'UIPasteboard\.general\.(string|setValue|setData)' .
```

## MASVS-CRYPTO: Cryptography

### Inspection Targets

- **Weak algorithms**: MD5, SHA1 (for signing), DES, 3DES, RC4
- **CryptoKit / CommonCrypto**: Proper usage
- **Key management**: Hardcoded cryptographic keys, use of key derivation functions
- **Secure Enclave**: Key protection combined with biometric authentication
- **Random number generation**: Use of `SecRandomCopyBytes` (`arc4random` is insufficient for cryptographic purposes)

```bash
# Weak cryptographic algorithms
grep -rn --include='*.swift' --include='*.m' \
  -iE '(CC_MD5|CC_SHA1|kCCAlgorithmDES|kCCAlgorithm3DES|\.md5|\.sha1)' .

# Hardcoded cryptographic keys
grep -rn --include='*.swift' \
  -E '(let|var)\s+(key|secret|iv|nonce)\s*[:=]\s*"[^"]{8,}"' .

# Random number generation
grep -rn --include='*.swift' --include='*.m' \
  -E '(arc4random|srand|rand\(\)|drand48)' .

# Secure Enclave usage check
grep -rn --include='*.swift' \
  -E '(SecureEnclave|\.secureEnclave|kSecAttrTokenIDSecureEnclave)' .
```

## MASVS-AUTH: Authentication

### Inspection Targets

- **Local Authentication**: Touch ID / Face ID implementation
- **Biometric fallback**: Security when falling back to passcode
- **LAContext**: Usage of `evaluatePolicy` and verification of `evaluatedPolicyDomainState`
- **Token management**: Storing refresh tokens in Keychain
- **Session control**: Timeout, re-authentication when returning from background

```bash
# Biometric authentication implementation
grep -rn --include='*.swift' \
  -E '(LAContext|canEvaluatePolicy|evaluatePolicy|biometryType)' .

# Biometric authentication policy (deviceOwnerAuthentication includes passcode fallback)
grep -rn --include='*.swift' \
  -E '(deviceOwnerAuthenticationWithBiometrics|deviceOwnerAuthentication)' .

# Token storage in Keychain
grep -rn --include='*.swift' \
  -E '(SecItemAdd|SecItemUpdate|SecItemCopyMatching|SecItemDelete)' .
```

## MASVS-NETWORK: Network

### Inspection Targets

- **ATS (App Transport Security)**: Verify `NSAllowsArbitraryLoads` is disabled
- **Certificate Pinning**: Implementation via URLSession delegate or TrustKit
- **Cleartext communication**: Use of HTTP (non-HTTPS) endpoints
- **Proxy detection**: Countermeasures against man-in-the-middle attacks

```bash
# Check ATS configuration
find . -name 'Info.plist' -not -path '*/Pods/*' -not -path '*/.build/*' \
  -exec grep -A 10 'NSAppTransportSecurity' {} +

# NSAllowsArbitraryLoads (allows all HTTP = dangerous)
find . -name 'Info.plist' -not -path '*/Pods/*' \
  -exec grep -l 'NSAllowsArbitraryLoads.*true' {} \;

# Certificate Pinning implementation
grep -rn --include='*.swift' \
  -E '(urlSession.*didReceive.*challenge|SecTrustEvaluate|TrustKit|pinnedDomains)' .

# HTTP URL usage (cleartext)
grep -rn --include='*.swift' --include='*.m' \
  -E 'http://[^l][^o][^c][^a][^l]' . | grep -v '// '
```

## MASVS-PLATFORM: Platform Interaction

### Inspection Targets

- **Universal Links**: `apple-app-site-association` configuration, input validation
- **Custom URL Schemes**: Handling of unvalidated URL parameters
- **WebView**: JavaScript settings in `WKWebView`, `file://` access
- **App Extensions**: Scope restrictions for data sharing
- **UIPasteboard**: Inter-app data leakage
- **Screenshot prevention**: Use of `UITextField.isSecureTextEntry`

```bash
# Universal Links / URL Schemes
grep -rn --include='*.swift' \
  -E '(application.*open.*url|userActivity.*webpageURL|NSUserActivity)' .

# URL Scheme input validation
grep -rn --include='*.swift' \
  -E '(func\s+application.*open\s+url|UIApplication.*openURL)' .

# WebView configuration
grep -rn --include='*.swift' \
  -E '(WKWebView|WKWebViewConfiguration|javaScriptEnabled|allowFileAccessFromFileURLs)' .

# App Extensions data sharing
grep -rn --include='*.swift' \
  -E '(UserDefaults\(suiteName|FileManager.*containerURL.*appGroupIdentifier)' .
```

## MASVS-CODE: Code Quality

### Inspection Targets

- **Compiler protections**: PIE, Stack Canaries, ARC
- **Dependency libraries**: Vulnerabilities in CocoaPods/SPM/Carthage
- **Debug code**: Debug functionality outside `#if DEBUG` guards
- **Input validation**: Sanitization of input via deep links and IPC

```bash
# Remaining debug code
grep -rn --include='*.swift' \
  -E '(#if\s+DEBUG|debugPrint|assert\(|precondition\()' .

# CocoaPods vulnerability check
[ -f Podfile.lock ] && pod audit 2>/dev/null

# SPM dependency check
find . -name 'Package.resolved' -exec cat {} \;
```

## MASVS-RESILIENCE: Tamper Resistance

### Inspection Targets

- **Jailbreak detection**: File system checks, Cydia URL scheme
- **Debugger detection**: Detection via `ptrace`, `sysctl`
- **Integrity checks**: Code signature verification
- **Anti-reverse-engineering**: String obfuscation

```bash
# Jailbreak detection implementation
grep -rn --include='*.swift' --include='*.m' \
  -E '(cydia|/Applications/Cydia|/usr/sbin/sshd|/bin/bash|jailbreak|isJailbroken)' .

# Debugger detection
grep -rn --include='*.swift' --include='*.m' \
  -E '(ptrace|PT_DENY_ATTACH|sysctl|CTL_KERN|KERN_PROC)' .
```

## MASVS-PRIVACY: Privacy

### Inspection Targets

- **ATT (App Tracking Transparency)**: Implementation of `requestTrackingAuthorization`
- **Privacy Manifest**: Existence and content of `PrivacyInfo.xcprivacy`
- **Location data**: Clear purpose declaration, minimizing precision
- **Camera and microphone**: Clear purpose declaration
- **Data minimization**: Collecting only the minimum necessary data

```bash
# ATT implementation
grep -rn --include='*.swift' \
  -E '(ATTrackingManager|requestTrackingAuthorization|trackingAuthorizationStatus)' .

# Privacy Manifest
find . -name 'PrivacyInfo.xcprivacy' -not -path '*/Pods/*'

# Location data usage
grep -rn --include='*.swift' \
  -E '(CLLocationManager|requestWhenInUseAuthorization|requestAlwaysAuthorization)' .

# Purpose descriptions in Info.plist
find . -name 'Info.plist' -not -path '*/Pods/*' \
  -exec grep -l 'NSLocationWhenInUseUsageDescription\|NSCameraUsageDescription\|NSMicrophoneUsageDescription' {} \;
```

## iOS Security Checklist

- [ ] Appropriate access attributes are set for Keychain
- [ ] No sensitive data is stored in NSUserDefaults
- [ ] ATS is enabled and `NSAllowsArbitraryLoads` is false
- [ ] Certificate Pinning is implemented
- [ ] Biometric authentication is integrated with Keychain ACL
- [ ] Unnecessary JavaScript is disabled in WebViews
- [ ] Universal Links input is validated
- [ ] No sensitive data is output in logs
- [ ] Screenshots are protected during background transitions
- [ ] Privacy Manifest exists and is accurate
- [ ] No weak cryptographic algorithms are used
- [ ] Debug code is not included in production builds
