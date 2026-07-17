# バグレポート

## 基本情報

| 項目 | 内容 |
|------|------|
| 番号 | BUG-20260715-01 |
| 報告日 | 2026-07-15 |
| 報告者 | ユーザー |
| 対象機能 | 設定画面・Claude Code認証状態確認 |
| 重要度 | 高 |
| 状態 | 対応中 |

## 現象

Cotaskaの設定画面で「Claude Code認証」を押下すると、Claude Codeの認証状態を確認できず、次のエラーが表示される。

```text
Claude Code認証確認に失敗しました: Claude Code native binary at C:\WorkDevelop\Agent_Hisyo\10_Cotaska-タスク管理ツール\_app\resources\app.asar\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe exists but failed to launch. This usually means the binary does not match this system's libc — e.g. spawning a musl-linked binary on a glibc Linux host fails because the musl dynamic loader (/lib/ld-musl-*) is missing. Specify a matching binary with options.pathToClaudeCodeExecutable.
```

メッセージにはLinuxのlibcに関する例が含まれるが、本件はWindows環境で発生している。

## 再現手順

1. Cotaskaのパッケージ版を起動する。
2. 設定画面でAI連携先にClaude Codeを選択する。
3. 「Claude Code認証」を押下する。
4. 認証状態確認に失敗し、native binaryを起動できないエラーが表示されることを確認する。

## 期待動作

同梱されたWindows x64版のClaude Code実行ファイルが正常に起動し、設定されたローカル認証またはBedrock認証の状態が画面に表示される。

## 調査メモ

- エラーに記録された実行ファイルのパスが `resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` となっている。
- Electronのasarアーカイブ内に格納された実行ファイルは、ファイルとして参照できてもWindowsのプロセスとして直接起動できない。
- 現在の `package.json` の `asarUnpack` は `node_modules/@anthropic-ai/claude-agent-sdk/**` のみをClaude関連の展開対象としている。
- 実際のWindows x64版 `claude.exe` はSDK本体とは別の兄弟パッケージ `@anthropic-ai/claude-agent-sdk-win32-x64` に含まれるため、現行パターンには一致せず `app.asar` 内に残る。
- 開発環境の `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` を直接実行すると `2.1.207 (Claude Code)` が返り、実行ファイル自体は現在のWindows x64環境で動作した。
- 以上から、CPUアーキテクチャ不一致やLinuxのmusl/glibc問題ではなく、Electron Builderの展開対象不足が原因と判断する。エラー内のlibc説明はSDKの汎用メッセージであり、本件の直接原因ではない。

### 再調査（2026-07-16）

- `asarUnpack` へ `claude-agent-sdk-win32-*/**` を追加する修正は適用済みで、パッケージ版の `resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` に実行ファイルが展開されていることを確認した（展開自体は成功している）。
- それにもかかわらず不具合が再現するのは、SDK（`app.asar` 内の `sdk.mjs`）が自身の位置を基準に `require.resolve` で `claude.exe` を解決するため、返るパスが `app.asar` **内**（`...\app.asar\node_modules\...\claude.exe`）のままになるためである。
- asar内に見えるexeは `existsSync` では真になるが、Windowsのプロセスとしてspawnできず起動に失敗する。このためSDKは「found（未検出）」ではなく「exists but failed to launch（存在するが起動失敗）」を返している。エラーメッセージ末尾も `options.pathToClaudeCodeExecutable` の指定を促している。
- 結論: 「ファイルを展開する」だけでは不十分で、展開済み（`app.asar.unpacked` 側）の実exeパスを `options.pathToClaudeCodeExecutable` でSDKへ明示的に渡す必要がある。

## 追加修正方針（2026-07-16）

`claudeCodeService.js` に、配布ビルド時のみ `process.resourcesPath/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude(.exe)` を算出するヘルパー `resolveClaudeExecutablePath()` を追加し、`checkAuthStatus` とチャット送信双方の `sdk.query()` の `options.pathToClaudeCodeExecutable` に渡す。開発環境（非パッケージ）ではSDK既定の解決に委ねるため `null` を返す。

## 修正方針

`20_app/package.json` の `asarUnpack` にプラットフォーム別Claude Agent SDKパッケージを追加し、`claude.exe` を `resources/app.asar.unpacked` 配下へ展開する。

Windows向けの修正候補は次のとおり。

```json
"asarUnpack": [
  "node_modules/@openai/codex-*/vendor/**",
  "node_modules/@anthropic-ai/claude-agent-sdk/**",
  "node_modules/@anthropic-ai/claude-agent-sdk-win32-*/**"
]
```

修正後はパッケージ版を再生成し、次を確認する。

1. `claude.exe` が `resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/` に配置される。
2. 設定画面の認証状態確認でnative binary起動エラーが発生しない。
3. ローカル認証またはBedrock認証の結果が意図した区分で表示される。
4. Claude Codeチャット送信時にも同じ実行ファイルを正常に起動できる。
5. Codex連携と既存の配布ビルドにデグレードがない。

## 検証状況

| 確認項目 | 結果 |
|---|---|
| エラー内の実行パス確認 | `app.asar` 内を指していることを確認 |
| `asarUnpack` 設定確認 | プラットフォーム別パッケージが対象外であることを確認 |
| 開発環境の同梱 `claude.exe --version` | 成功（`2.1.207 (Claude Code)`） |
| 修正後の配布ビルド | 未実施 |
| パッケージ版の認証状態確認 | 未実施 |
| `asarUnpack` 修正後の `claude.exe` 展開 | 成功（`app.asar.unpacked/.../claude-agent-sdk-win32-x64/claude.exe` を確認） |
| SDKのパス解決挙動 | `require.resolve` により `app.asar` 内パスを返し起動失敗することをSDK実装（`sdk.mjs` の `IA()`/`eZ()`）で確認 |
| `resolveClaudeExecutablePath()` の算出パス | 実配置の展開済みexeと一致することを確認 |
| `pathToClaudeCodeExecutable` 明示指定の追加 | 実装済み（構文チェック成功） |

## 関連ファイル

- `20_app/package.json` — Electron Builderの `asarUnpack` 設定
- `20_app/package-lock.json` — Claude Agent SDKとプラットフォーム別パッケージの依存関係
- `20_app/src/main/claudeCodeService.js` — Claude Agent SDKの読み込みと認証状態確認処理
- `00_mgmt/Cotaska_タスク管理ツール/data/tasks/T-0466.md` — 修正・検証・ユーザー確認タスク
- `10_docs/30_変更管理/10_仕様変更/20260713_CHG-102_ClaudeCodeチャット連携個人利用.md` — Claude Code連携の仕様変更記録
