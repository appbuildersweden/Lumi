# Security Audit Skill ベストプラクティス分析レポート

**調査日**: 2026-04-11
**調査対象**: Claude Code セキュリティ skill エコシステム全体
**目的**: security-audit skill を世界水準に引き上げるためのパターン収集と統合推奨

---

## 目次

1. [調査対象リポジトリ・情報源](#1-調査対象リポジトリ情報源)
2. [セキュリティ関連パターンの発見](#2-セキュリティ関連パターンの発見)
3. [Skill アーキテクチャのベストプラクティス](#3-skill-アーキテクチャのベストプラクティス)
4. [Hook パターンによるセキュリティ自動化](#4-hook-パターンによるセキュリティ自動化)
5. [Agent オーケストレーションパターン](#5-agent-オーケストレーションパターン)
6. [統合推奨事項と実装提案](#6-統合推奨事項と実装提案)
7. [優先度付きロードマップ](#7-優先度付きロードマップ)

---

## 1. 調査対象リポジトリ・情報源

### 主要リポジトリ

| リポジトリ | 概要 | 特筆事項 |
|-----------|------|---------|
| [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 140K+ stars のエージェントハーネス最適化システム。38 agents, 156+ skills, 72 commands | セキュリティガイド、AgentShield 統合、security-reviewer agent を含む |
| [trailofbits/skills](https://github.com/trailofbits/skills) | Trail of Bits のセキュリティ特化 skill マーケットプレイス。38 plugins | 業界最高水準の監査ワークフロー、variant analysis、fp-check など |
| [agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) | OWASP Top 10:2025 + ASVS 5.0 + Agentic AI Security 統合 skill | 20+ 言語固有のセキュリティパターン、unsafe/safe コード比較 |
| [netresearch/security-audit-skill](https://github.com/netresearch/security-audit-skill) | PHP/TYPO3 特化セキュリティ監査 skill | 80+ 自動チェックポイント、PreToolUse hook、CVSS v4.0 対応 |
| [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config) | Trail of Bits の Claude Code 設定ベストプラクティス | opinionated な設定とワークフロー |

### 公式ドキュメント・記事

| ソース | 内容 |
|--------|------|
| [Anthropic Skill Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | 公式 skill 作成ガイドライン。progressive disclosure、feedback loop パターン |
| [Claude Code Skills Docs](https://code.claude.com/docs/en/skills) | skill のライフサイクル、frontmatter、subagent 実行、hook 連携 |
| [Backslash Security](https://www.backslash.security/blog/claude-code-security-best-practices) | Claude Code 設定のハードニングガイド |
| [Snyk: Top Claude Skills for Cybersecurity](https://snyk.io/articles/top-claude-skills-cybersecurity-hacking-vulnerability-scanning/) | 9 つの主要セキュリティ skill のレビュー |
| [everything-claude-code/the-security-guide.md](https://github.com/affaan-m/everything-claude-code/blob/main/the-security-guide.md) | 包括的なエージェントセキュリティガイド |

---

## 2. セキュリティ関連パターンの発見

### 2.1 everything-claude-code: セキュリティガイドの重要パターン

#### 脅威モデル「Lethal Trifecta」

everything-claude-code のセキュリティガイドは、エージェントセキュリティの核心として「致命的な三要素」を定義している:

1. **プライベートデータ** (private data)
2. **信頼されないコンテンツ** (untrusted content)
3. **外部通信** (external communication)

> "once all three live in the same runtime, prompt injection stops being funny and starts becoming data exfiltration."

**我々の skill への適用**: 監査対象のプロジェクトがこの三要素を同時に扱うケースを最優先で検出すべき。

#### 最近の CVE インシデント (2025-2026)

| CVE | CVSS | 内容 |
|-----|------|------|
| CVE-2025-59536 | 8.7 | trust dialog 承認前にプロジェクトコードが実行される |
| CVE-2026-21852 | - | ANTHROPIC_BASE_URL を攻撃者制御に書き換え、API key を漏洩 |

エコシステム統計:
- スキャンされた 3,984 skills のうち **36% に prompt injection 脆弱性**
- 1,467 の悪意あるペイロードがエコシステム内に存在
- Microsoft が 31 社、14 業界で **memory poisoning** を確認

#### 防御アーキテクチャパターン

**Identity Separation (アイデンティティ分離)**:
```
- エージェント専用アカウントの作成 (agent@yourdomain.com)
- 短命でスコープされた認証情報
- 個人アカウントとの共有禁止
```

**Isolation Strategy (分離戦略)**:
```
- コンテナ/VM 内での実行
- デフォルトでネットワーク egress を無効化
- ファイルシステムアクセスの制限
- Linux capabilities の最小化
```

**Permission Denial Rules (権限拒否ルール)**:
```
拒否すべきパス:
- ~/.ssh/**, ~/.aws/**, 環境ファイル
- 認証情報ディレクトリへの書き込み
- curl | bash, ssh, scp, nc の直接実行
```

**Sanitization Techniques (サニタイゼーション)**:
```
- zero-width Unicode 文字の検出 (U+200B, U+200C, U+200D)
- 双方向オーバーライド文字の検出 (U+202A-202E)
- HTML コメントと隠しブロックの除去
- PDF/DOCX から必要なテキストのみ抽出
```

#### AgentShield 統合

AgentShield は以下の 5 領域をスキャン:
1. **CLAUDE.md**: ハードコード secret、auto-run ディレクティブ、injection パターン
2. **settings.json**: 過度に広い権限、制限の欠如
3. **mcp.json**: リスクのあるサーバー設定、supply chain
4. **hooks/**: コマンドインジェクション、データ exfiltration
5. **agents/*.md**: 無制限のツールアクセス、prompt injection 表面

**リスクグレーディング**: A-F の 6 段階 (0-100 スケール)

### 2.2 everything-claude-code: security-reviewer Agent

security-reviewer agent は以下の即座にフラグすべきパターンを定義:

| パターン | 修正方針 |
|---------|---------|
| ハードコードされた認証情報 | 環境変数に移動 |
| 未検証の shell 実行 | `execFile` 等の安全な API に置換 |
| SQL 文字列結合 | パラメータ化クエリに変更 |
| ユーザーデータによる DOM 操作 | `textContent` または DOMPurify 使用 |
| 無制限の URL fetch | ドメインホワイトリスト実装 |
| 平文パスワード比較 | `bcrypt.compare()` 使用 |
| ルート認証の欠落 | ミドルウェア検証追加 |
| トランザクションの race condition | DB ロック実装 |
| rate limiting なし | `express-rate-limit` 導入 |
| ログ内の secret 露出 | 出力前にサニタイズ |

**トリガー条件**: endpoint 実装時、認証変更時、ユーザー入力処理時、DB クエリ変更時、ファイルアップロード、決済統合、依存関係更新時。

### 2.3 Trail of Bits: セキュリティ skill の設計パターン

#### Variant Analysis (パターンベース脆弱性発見)

Trail of Bits の variant-analysis skill は 5 ステップの方法論を定義:

1. **Root Cause Analysis**: 根本的な弱点の理解（症状ではなく原因）
2. **Exact Match Verification**: 既知インスタンスのみに一致する正確なパターン作成
3. **Abstraction Planning**: 具体的要素と汎化要素の決定
4. **Incremental Generalization**: 1 反復につき 1 要素の変更、精度 50% 未満で停止
5. **Results Triage**: 場所、信頼度、exploitability、優先度の文書化

**ツール選択フレームワーク**:
- ripgrep: 表面的な高速検索
- Semgrep: ビルド依存なしのシンプルパターン
- Semgrep taint/CodeQL: 関数間データフロー追跡
- CodeQL: 高度な手続き間分析

#### False Positive Verification (fp-check)

fp-check skill の「Half of false positives collapse at Step 0」は重要な知見:

**Step 0: Claim Clarification** (主張の明確化):
- 正確な脆弱性の主張（関数/行を特定）
- 想定される root cause とトリガー機構
- 影響範囲と脅威モデル
- 呼び出し元の制約とアーキテクチャ的保護

**拒否すべきラショナリゼーション**:
- パターン認識 alone では脆弱性の証明にならない
- 「unsafe に見える」→ 完全なデータフロー追跡が必要
- 他の場所に同様の脆弱性がある → このインスタンスの検証は不要にならない
- 効率のためのショートカット → すべてのバグに完全検証を

#### Differential Review (差分セキュリティレビュー)

リスクファーストの分析方法論:

**コードベースサイジング**:
| サイズ | ファイル数 | アプローチ |
|--------|-----------|----------|
| SMALL | <20 | 完全な依存関係分析、git blame 全件 |
| MEDIUM | 20-200 | 1-hop 依存関係、優先ファイルフォーカス |
| LARGE | 200+ | クリティカル実行パスのみ |

**即座にエスカレーション**する条件:
- セキュリティ関連関数の削除
- アクセス制御の排除
- バリデーションの除去
- 未チェックの外部呼び出しの導入
- 50+ 下流呼び出し元への高リスク変更

#### Sharp Edges (API 誤用検出)

6 カテゴリの sharp edge パターン:

1. **Algorithm/Mode Selection Footguns**: 暗号アルゴリズム選択 API の危険性
2. **Dangerous Defaults**: 0/empty/null によるセキュリティ無効化
3. **Primitive vs. Semantic APIs**: 型安全でない raw bytes API
4. **Configuration Cliffs**: 1 設定ミスで壊滅的障害
5. **Silent Failures**: エラーが表面化しないセキュリティ侵害
6. **Stringly-Typed Security**: 文字列型のセキュリティ値によるインジェクション

**3 種類の攻撃者モデル**:
- **The Scoundrel**: 悪意あるアクター（設定を制御可能）
- **The Lazy Developer**: ドキュメントを読まず、サンプルをコピペ
- **The Confused Developer**: API を誤解している

#### Audit Context Building (深層コンテキスト構築)

脆弱性発見前の超精密コード分析手法:

**Phase 1: Initial Orientation** - モジュール、entry point、actor、状態変数のマッピング

**Phase 2: Ultra-Granular Function Analysis** - 全非自明関数の微細分析:
- 各ブロックに対する First Principles reasoning
- 5 Whys / 5 Hows 分析
- invariant の特定と追跡
- 最低 3 invariants, 5 assumptions, 3 external interaction risks

**Phase 3: Global System Understanding** - 状態マッピング、trust boundary、複雑度クラスター

#### Supply Chain Risk Auditor

6 つのリスク要因:
1. 単一メンテナー/チーム
2. メンテナンス停止状態
3. 低い人気度（stars/downloads）
4. 高リスク機能（FFI、デシリアライゼーション、サードパーティコード実行）
5. 過去の CVE 履歴
6. セキュリティ連絡先の欠如

#### Insecure Defaults (安全でないデフォルト検出)

**fail-open vs fail-secure** の核心的区別:
- **fail-open (CRITICAL)**: 設定がない場合に弱いデフォルトで動作
- **fail-secure (SAFE)**: 必要な設定がない場合にクラッシュ

検出パターン:
- Fallback Secrets（環境変数未設定時のハードコードフォールバック）
- Hardcoded Credentials
- Insecure Defaults（無効化されたセキュリティフラグ）
- Weak Cryptography（MD5, SHA1, DES, RC4, ECB）
- Permissive Access（ワイルドカード CORS）
- Debug Features の本番露出

### 2.4 OWASP Security Skill (agamm/claude-code-owasp)

#### OWASP Agentic AI Security (2026) - 新しい脅威カテゴリ

| コード | 脅威 | 緩和策 |
|--------|------|--------|
| ASI01 | Goal Hijack | 入力サニタイゼーション、目標境界、行動監視 |
| ASI02 | Tool Misuse | 最小権限、粒度の細かい権限、I/O バリデーション |
| ASI03 | Identity & Privilege Abuse | 短命スコープトークン、ID 検証 |
| ASI04 | Supply Chain | 署名検証、サンドボックス、プラグインホワイトリスト |
| ASI05 | Code Execution | 分離実行環境、静的分析、人間承認 |
| ASI06 | Memory Poisoning | 格納データ検証、信頼度別セグメント |
| ASI07 | Insecure Inter-Agent Comms | メッセージ認証、暗号化、整合性検証 |
| ASI08 | Cascading Failures | サーキットブレーカー、graceful degradation |
| ASI09 | Human-Agent Trust Exploitation | AI コンテンツラベリング、検証ワークフロー |
| ASI10 | Rogue Agents | 行動監視、kill switch、異常検知 |

#### ASVS 5.0 三段階検証

| レベル | 対象 | 要件例 |
|--------|------|--------|
| Level 1 | 全アプリ | 12 文字以上パスワード、breached リスト照合、rate limiting、128bit+ session token、HTTPS 必須 |
| Level 2 | 機密データ | Level 1 + MFA、暗号鍵管理、セキュリティイベントログ、全パラメータ入力検証 |
| Level 3 | 重要システム | Level 1&2 + HSM、脅威モデリング文書、高度な監視、ペネトレーションテスト |

#### 20+ 言語固有セキュリティパターン

言語ファミリー別の特徴的リスク:
- **動的型付け** (JS, Python, PHP, Ruby): 型強制脆弱性、eval injection、弱い比較
- **コンパイル言語** (Java, C#, Go, Rust, Kotlin): デシリアライゼーション RCE、unsafe ブロック、リフレクション
- **低レベル言語** (C/C++): バッファオーバーフロー、use-after-free、format string
- **関数型言語** (Elixir, Scala, Lua): atom 枯渇、コード評価 injection

#### Deep Security Analysis Framework (10 項目)

1. メモリ管理（managed vs manual、GC ベースの exploitation）
2. 型システム強度（型強制と型混同）
3. シリアライゼーション機構（デシリアライゼーションライブラリ評価）
4. 並行性モデル（race condition、TOCTOU）
5. FFI（型安全性の境界が崩れる箇所）
6. 標準ライブラリの CVE 履歴
7. エコシステムセキュリティ（typosquatting、dependency confusion）
8. ビルドシステム脆弱性（ビルド設定ファイルのスクリプトインジェクション）
9. Runtime 動作差異（debug vs release）
10. エラー伝播パターン（silent fail、fail-open）

### 2.5 Netresearch: PHP Security Audit Skill

#### PreToolUse Hook パターン

`check_risky_command.py` が実装する 28 の危険パターン:

| カテゴリ | 検出対象 |
|---------|---------|
| 破壊的操作 | システムディレクトリへの再帰的削除 |
| 権限問題 | 777/666 のパーミッション設定 |
| リモートコード実行 | `curl \| bash`, wget パイプ |
| 認証情報露出 | ハードコードパスワード、トークン、git URL 埋め込み認証情報 |
| データベースリスク | DROP, TRUNCATE, DELETE 操作 |
| システムレベル脅威 | dd によるブロックデバイス書き込み、ファイルシステムフォーマット |

重要な設計選択: **ブロックではなく警告** を発行し、ユーザーの判断を尊重。

#### 80+ 自動チェックポイント (checkpoints.yaml)

カテゴリ: 認証実装、認可実施、入力処理、出力エンコーディング、データ保護、セッション管理、暗号実装、API セキュリティ、エラー処理、設定セキュリティ

### 2.6 Backslash Security: Claude Code 設定ハードニング

#### managed-settings.json の推奨設定

| 設定 | 推奨 | セキュリティ影響 |
|------|------|---------------|
| `disableAllHooks` | 有効化 | pre/post-tool スクリプト実行の防止 |
| `cleanupPeriodDays` | 7-14 日 | 機密 transcript の露出制限 |
| `env` | 限定使用 | 平文 secret を含めない |

#### MCP Server セキュリティ

- 危険: `"enableAllProjectMcpServers": true`
- 安全: `"enabledMcpjsonServers": ["github", "memory"]`（明示的ホワイトリスト）
- 予防的ブロック: `"disabledMcpjsonServers": ["filesystem"]`

#### Permission Model (階層的防御)

1. **Allowlist**: 完全に無害なコマンドのみ（echo、read-only 操作）
2. **Asklist**: リスクはあるが有用なコマンド（git push、docker run）
3. **Denylist**: ブロック対象（curl、WebFetch、.env アクセス）
4. **Default mode**: Ask（silent overreach の防止）

---

## 3. Skill アーキテクチャのベストプラクティス

### 3.1 Anthropic 公式ガイドラインからの重要原則

#### Progressive Disclosure (段階的開示)

```
metadata ロード (~100 tokens) → SKILL.md ロード (<5k tokens) → 参照ファイル (必要時のみ)
```

**適用**: SKILL.md は 500 行以下に保ち、詳細は参照ファイルに分離。参照は 1 レベルの深さまで。

#### Freedom のスペクトラム

| 自由度 | 使用場面 | 例 |
|--------|---------|---|
| 高 | 複数のアプローチが有効 | コードレビュープロセス |
| 中 | 推奨パターンが存在 | レポート生成テンプレート |
| 低 | 操作が脆弱でエラーしやすい | DB マイグレーション、セキュリティ監査 |

> **セキュリティ監査は「低自由度」に分類される**: "Security audits, crypto implementations, compliance checks need rigid step-by-step enforcement."

#### Feedback Loop パターン

```
実行 → バリデーション → エラー修正 → 再実行
```

セキュリティ監査では:
1. スキャン実行
2. 結果の検証 (false positive チェック)
3. 追加調査
4. 最終レポート生成

#### 評価駆動開発

1. skill なしで Claude にタスクを実行させ、失敗箇所を記録
2. 3 つのテストシナリオで評価を構築
3. ベースラインを測定
4. 最小限の指示を作成してギャップに対処
5. 評価を実行し、ベースラインと比較、改善を繰り返す

### 3.2 Trail of Bits CLAUDE.md のスキル作成ガイドライン

#### 必須セクション (セキュリティ skill 向け)

```markdown
## When to Use
具体的な適用シナリオ

## When NOT to Use
境界条件と代替手段

## Rationalizations to Reject
発見を妥協させる一般的なショートカット
```

> "Behavioral guidance over reference dumps - Don't paste entire specs; teach when and how to look things up."

#### 命名規約

- kebab-case、64 文字以内
- gerund 形式を推奨: `analyzing-contracts`, `detecting-vulnerabilities`
- `{baseDir}` プレースホルダーでパスを解決

### 3.3 Four-Pattern Framework

1. **Context is Milk**: コンテキストを消費期限のある牛乳のように扱い、just-in-time でロード
2. **One Business Brain**: ドメイン知識を 1 つの権威ある場所に集約
3. **Skill Collaboration**: composable なコンポーネントとして設計
4. **Self-Learning**: 何が効果的だったかを記録する feedback loop を構築

### 3.4 Skill Frontmatter 活用パターン

```yaml
---
name: security-audit
description: ...
disable-model-invocation: true  # ユーザーのみ起動可能（副作用あり）
allowed-tools: Bash(grep *) Bash(rg *) Read Grep Glob  # 自動承認ツール
context: fork  # subagent で分離実行
agent: Explore  # 読み取り専用 agent
effort: max  # Opus 4.6 の最大推論力
hooks:  # skill スコープの hook
  - ...
paths: "**/*.ts,**/*.js,**/*.py"  # 特定パスでのみ自動起動
---
```

#### Dynamic Context Injection

```yaml
## 環境情報
- Node version: !`node --version`
- Dependencies: !`npm ls --depth=0 2>/dev/null`
- Git status: !`git log --oneline -5`
```

---

## 4. Hook パターンによるセキュリティ自動化

### 4.1 PreToolUse Hook: 危険コマンド検出

Netresearch の `check_risky_command.py` パターンに基づく実装:

```json
{
  "hooks": [
    {
      "type": "PreToolUse",
      "matcher": "Bash",
      "command": "python ${CLAUDE_SKILL_DIR}/scripts/check_risky_command.py"
    }
  ]
}
```

**28 の検出パターン** (severity: high/medium/low):
- 再帰的削除 (`rm -rf /`)
- 777/666 パーミッション
- `curl | bash` パイプ
- ハードコードパスワード/トークン
- DROP/TRUNCATE/DELETE
- dd ブロックデバイス書き込み
- ファイアウォールフラッシュ

### 4.2 PostToolUse Hook: 編集後セキュリティチェック

```json
{
  "hooks": [
    {
      "type": "PostToolUse",
      "matcher": "Edit",
      "command": "python ${CLAUDE_SKILL_DIR}/scripts/check_secret_leak.py"
    }
  ]
}
```

チェック対象:
- API key/token パターンの新規追加
- パスワードのハードコード
- AWS/GCP/Azure credentials
- private key の埋め込み

### 4.3 Stop Hook: セッション終了時サマリー

```json
{
  "hooks": [
    {
      "type": "Stop",
      "command": "python ${CLAUDE_SKILL_DIR}/scripts/session_security_summary.py"
    }
  ]
}
```

### 4.4 everything-claude-code の Hook アーキテクチャ

Hook Runtime Controls による柔軟な制御:
```bash
export ECC_HOOK_PROFILE=standard  # minimal, standard, strict
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
```

hook は Node.js で記述されクロスプラットフォーム互換性を確保。

### 4.5 Skill スコープ Hook (Claude Code 公式)

skill の frontmatter 内で hook を定義可能:

```yaml
---
name: security-audit
hooks:
  PreToolUse:
    - matcher: Bash
      command: "${CLAUDE_SKILL_DIR}/scripts/check_risky_command.py"
  PostToolUse:
    - matcher: Edit
      command: "${CLAUDE_SKILL_DIR}/scripts/check_secret_leak.py"
---
```

---

## 5. Agent オーケストレーションパターン

### 5.1 Multi-Layer Security Audit パターン

everything-claude-code の agent アーキテクチャから:

```
planner agent → 監査計画作成
  ├── security-reviewer agent → OWASP Top 10 コードレビュー
  ├── code-reviewer agent → 一般的なコード品質チェック
  └── refactor-cleaner agent → dead code/legacy パターン検出
```

### 5.2 Trail of Bits の Skill Chain パターン

```
brainstorm → plan → execute → verify
```

セキュリティ監査では:
```
audit-context-building → variant-analysis → fp-check → differential-review
        (理解)            (発見)          (検証)        (報告)
```

### 5.3 AgentShield の 3-Agent Adversarial Review

`--opus` フラグで有効化される三段階パイプライン:
1. **Agent 1**: 初期スキャン
2. **Agent 2**: 初期結果の adversarial レビュー
3. **Agent 3**: 最終統合と信頼度スコアリング

### 5.4 Subagent 実行パターン

```yaml
---
name: security-deep-scan
context: fork
agent: Explore
allowed-tools: Read Grep Glob Bash(rg *) Bash(grep *)
---
```

`context: fork` で分離実行し、メインコンテキストを汚染しない。
`agent: Explore` で読み取り専用ツールに制限。

### 5.5 並列エージェント実行

```markdown
# 3 つの agent を並列実行:
1. Agent 1: 認証モジュールのセキュリティ分析
2. Agent 2: キャッシュシステムのパフォーマンスレビュー
3. Agent 3: ユーティリティの型チェック
```

### 5.6 Multi-Perspective Analysis

複雑な問題には複数の役割のサブエージェントを使用:
- Factual Reviewer (事実確認)
- Senior Engineer (アーキテクチャ評価)
- Security Expert (セキュリティ分析)
- Consistency Reviewer (整合性確認)

---

## 6. 統合推奨事項と実装提案

### 6.1 SKILL.md の改善

#### 現状の課題

1. **description が長すぎる**: 250 文字でトランケートされるため、最重要キーワードを先頭に
2. **"When NOT to Use" セクションがない**: Trail of Bits パターンに従い追加すべき
3. **"Rationalizations to Reject" セクションがない**: false positive を削減する重要なセクション
4. **自由度の明示がない**: セキュリティ監査は「低自由度」であることを明示すべき
5. **Feedback Loop が未実装**: スキャン → 検証 → 追加調査のループが必要

#### 推奨される SKILL.md 構造

```yaml
---
name: security-audit
description: Full-stack security audit with OWASP Top 10:2025, ASVS 5.0, and Agentic AI security. Use when auditing code, reviewing for vulnerabilities, or assessing security posture.
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(rg *) Bash(npm audit *) Bash(supabase *)
effort: max
hooks:
  PreToolUse:
    - matcher: Bash
      command: "${CLAUDE_SKILL_DIR}/scripts/check_risky_command.py"
---

# Security Audit

## When to Use
- セキュリティ脆弱性のコードレビュー
- OWASP Top 10 コンプライアンスチェック
- デプロイ前セキュリティ評価
- 新規プロジェクトのセキュリティベースライン確立
- 依存関係のリスク評価

## When NOT to Use
- 機能テスト（→ tdd-guide agent を使用）
- パフォーマンスチューニング（→ performance agent を使用）
- 一般的なコードレビュー（→ code-reviewer agent を使用）
- 単純な lint エラー修正

## Rationalizations to Reject
- 「これは開発環境だけの問題」→ 本番設定で上書きされるか検証が必要
- 「認証で保護されている」→ 認証バイパスの可能性を検証
- 「後で修正する予定」→ 現時点のリスクを文書化
- 「パターン認識で unsafe に見える」→ 完全なデータフロー追跡が必要
```

### 6.2 新規追加すべき参照ファイル

| ファイル | 内容 | 参考元 |
|---------|------|--------|
| `references/owasp-top10-2025.md` | OWASP Top 10:2025 チェックリスト + unsafe/safe コード対比 | agamm/claude-code-owasp |
| `references/owasp-agentic-ai.md` | OWASP Agentic AI Security (ASI01-ASI10) | agamm/claude-code-owasp |
| `references/asvs-5.md` | ASVS 5.0 三段階要件 | agamm/claude-code-owasp |
| `references/sharp-edges.md` | API 誤用パターン 6 カテゴリ | trailofbits/skills |
| `references/insecure-defaults.md` | fail-open 検出パターン | trailofbits/skills |
| `references/variant-analysis.md` | パターンベース脆弱性発見の 5 ステップ | trailofbits/skills |
| `references/false-positive-check.md` | 偽陽性検証ワークフロー | trailofbits/skills |
| `references/language-quirks.md` | 20+ 言語固有セキュリティリスク | agamm/claude-code-owasp |
| `references/agent-security.md` | エージェントセキュリティ設定 (hooks, MCP, permissions) | everything-claude-code |
| `references/claude-config-hardening.md` | Claude Code 設定ハードニングガイド | Backslash Security |

### 6.3 Hook 統合の具体的実装

#### scripts/check_risky_command.py (新規作成)

Netresearch の実装をベースに、以下を拡張:

```python
# 検出パターンの構造:
RISKY_PATTERNS = [
    {
        "pattern": r"rm\s+-rf\s+/",
        "severity": "high",
        "message": "Recursive deletion of root directory detected"
    },
    {
        "pattern": r"chmod\s+777",
        "severity": "high",
        "message": "World-writable permissions detected"
    },
    {
        "pattern": r"curl.*\|\s*(ba)?sh",
        "severity": "high",
        "message": "Remote code execution via pipe detected"
    },
    # ... 25+ additional patterns
]
```

#### scripts/check_secret_leak.py (新規作成)

PostToolUse hook で Edit 操作後にシークレット漏洩を検出:

```python
# 検出対象:
SECRET_PATTERNS = [
    r"(?i)(api[_-]?key|apikey)\s*[:=]\s*['\"][a-zA-Z0-9]{20,}",
    r"(?i)(secret|password|passwd|pwd)\s*[:=]\s*['\"][^'\"]{8,}",
    r"(?i)(aws_access_key_id)\s*[:=]\s*['\"]AKIA[A-Z0-9]{16}",
    r"(?i)(private[_-]?key)\s*[:=]",
    r"ghp_[a-zA-Z0-9]{36}",  # GitHub PAT
    r"sk-[a-zA-Z0-9]{48}",   # OpenAI API key
    r"-----BEGIN (RSA |EC )?PRIVATE KEY-----",
]
```

### 6.4 Agent 連携の具体的提案

#### security-reviewer subagent の活用

```yaml
# .claude/agents/security-deep-reviewer.md
---
name: security-deep-reviewer
description: Deep security review with OWASP Top 10 and variant analysis
model: opus-4-6
allowed-tools: Read Grep Glob
skills:
  - security-audit
---

You are a senior security auditor. Perform deep analysis following these steps:
1. Build audit context (understand architecture first)
2. Identify attack surface and trust boundaries
3. Check OWASP Top 10:2025 patterns
4. Perform variant analysis on any findings
5. Verify each finding (reject false positives)
6. Generate actionable report with CVSS scores
```

#### Multi-agent 監査ワークフロー

```
Phase 1: Reconnaissance (Explore agent)
  → プロジェクト構造、依存関係、entry point の特定

Phase 2: Parallel Analysis (fork context)
  ├── Agent A: Application Security (OWASP Top 10)
  ├── Agent B: Infrastructure Security (config, secrets)
  └── Agent C: Supply Chain Risk (dependencies)

Phase 3: Cross-Layer Analysis (main context)
  → Phase 2 の結果を統合、cross-layer 脆弱性を検出

Phase 4: Verification (fp-check pattern)
  → 各 finding の false positive 検証

Phase 5: Reporting
  → CVSS スコアリング、remediation roadmap 生成
```

### 6.5 Checkpoints / Verification Loop

Netresearch の `checkpoints.yaml` パターンを採用:

```yaml
# checkpoints.yaml
categories:
  authentication:
    - id: AUTH-001
      check: "Password hashing uses Argon2/bcrypt"
      severity: critical
      method: grep
      patterns: ["MD5", "SHA1", "sha256"]

  authorization:
    - id: AUTHZ-001
      check: "All endpoints have authentication middleware"
      severity: critical
      method: grep

  input_validation:
    - id: INPUT-001
      check: "No SQL string concatenation"
      severity: critical
      method: grep
      patterns: ["+ req.", "+ request.", "f\"SELECT", "f'SELECT"]

  cryptography:
    - id: CRYPTO-001
      check: "No weak algorithms (DES, RC4, ECB, MD5 for security)"
      severity: high
      method: grep
```

### 6.6 CVSS v4.0 スコアリングの統合

```markdown
## Severity Scoring

Each finding receives a CVSS v4.0 score:

| Metric Group | Factors |
|-------------|---------|
| Base | Attack Vector, Complexity, Privileges, User Interaction |
| Threat | Exploit Maturity |
| Environmental | Modified Base Metrics |

Severity mapping:
- Critical: 9.0-10.0
- High: 7.0-8.9
- Medium: 4.0-6.9
- Low: 0.1-3.9
- Info: 0.0
```

### 6.7 Dynamic Context Injection の活用

```yaml
## Project Context (auto-detected)
- Package manager: !`ls package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null | head -1`
- Framework: !`grep -l "next\|react\|vue\|angular\|express" package.json 2>/dev/null`
- Dependencies with known vulnerabilities: !`npm audit --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Critical: {d.get(\"metadata\",{}).get(\"vulnerabilities\",{}).get(\"critical\",0)}, High: {d.get(\"metadata\",{}).get(\"vulnerabilities\",{}).get(\"high\",0)}')" 2>/dev/null || echo "N/A"`
- Git status: !`git log --oneline -3 2>/dev/null`
```

---

## 7. 優先度付きロードマップ

### Phase 1: 基盤強化 (即座実行)

| 項目 | 優先度 | 工数見積 | 参考元 |
|------|--------|---------|--------|
| SKILL.md に "When NOT to Use" セクション追加 | Critical | 30 min | Trail of Bits |
| SKILL.md に "Rationalizations to Reject" セクション追加 | Critical | 30 min | Trail of Bits fp-check |
| description を 250 文字以内に最適化 | High | 15 min | Anthropic 公式 |
| frontmatter に `disable-model-invocation: true` 追加 | High | 5 min | Anthropic 公式 |
| frontmatter に `effort: max` 追加 | Medium | 5 min | Anthropic 公式 |

### Phase 2: セキュリティ知識の拡充 (1-2 日)

| 項目 | 優先度 | 工数見積 | 参考元 |
|------|--------|---------|--------|
| OWASP Top 10:2025 参照ファイル作成 | Critical | 2h | agamm/claude-code-owasp |
| OWASP Agentic AI Security 参照ファイル作成 | High | 1h | agamm/claude-code-owasp |
| Language-specific security quirks 参照ファイル作成 | High | 2h | agamm/claude-code-owasp |
| Sharp edges / insecure defaults 参照ファイル作成 | High | 1.5h | Trail of Bits |
| False positive verification ガイド作成 | Medium | 1h | Trail of Bits fp-check |

### Phase 3: 自動化 Hook 実装 (2-3 日)

| 項目 | 優先度 | 工数見積 | 参考元 |
|------|--------|---------|--------|
| PreToolUse hook: risky command 検出スクリプト | High | 3h | Netresearch |
| PostToolUse hook: secret leak 検出スクリプト | High | 2h | everything-claude-code |
| checkpoints.yaml: 自動検証チェックポイント | Medium | 4h | Netresearch |
| hooks.json 設定ファイル作成 | Medium | 1h | Netresearch |

### Phase 4: Agent オーケストレーション (3-5 日)

| 項目 | 優先度 | 工数見積 | 参考元 |
|------|--------|---------|--------|
| Multi-agent 並列監査ワークフロー設計 | High | 4h | everything-claude-code |
| Subagent 定義 (security-deep-reviewer) | Medium | 2h | Trail of Bits |
| Adversarial review pipeline (3-agent) | Medium | 4h | AgentShield |
| Variant analysis ワークフロー統合 | Low | 3h | Trail of Bits |

### Phase 5: 品質保証と評価 (継続的)

| 項目 | 優先度 | 工数見積 | 参考元 |
|------|--------|---------|--------|
| 評価シナリオ 3 件作成 (evaluation-driven development) | High | 3h | Anthropic 公式 |
| 複数モデル (Haiku, Sonnet, Opus) でのテスト | Medium | 2h | Anthropic 公式 |
| Claude A/B パターンによる iterative refinement | Medium | 継続的 | Anthropic 公式 |
| CVSS v4.0 スコアリング精度の検証 | Low | 2h | Netresearch |

---

## 補足: セキュリティエコシステムの供給チェーンリスク

Snyk の ToxicSkills 調査結果は無視できない:

> "prompt injection in 36% of skills tested and 1,467 malicious payloads across the ecosystem"

**我々の skill への含意**:
1. 第三者 skill を使用する前の検証手順を文書化すべき
2. 自身の skill が信頼できることを証明するための透明性（MIT ライセンス、全コード公開）
3. hook スクリプトの安全性を保証するためのコードレビュープロセス

---

## 出典・参考リンク

- [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) - Agent Harness Performance Optimization System
- [everything-claude-code Security Guide](https://github.com/affaan-m/everything-claude-code/blob/main/the-security-guide.md)
- [trailofbits/skills](https://github.com/trailofbits/skills) - Trail of Bits Claude Code Security Skills
- [agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) - OWASP Security Best Practices Skill
- [netresearch/security-audit-skill](https://github.com/netresearch/security-audit-skill) - PHP Security Audit Skill
- [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config) - Claude Code Configuration Best Practices
- [Anthropic: Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Backslash Security: Claude Code Best Practices](https://www.backslash.security/blog/claude-code-security-best-practices)
- [Snyk: Top Claude Skills for Cybersecurity](https://snyk.io/articles/top-claude-skills-cybersecurity-hacking-vulnerability-scanning/)
