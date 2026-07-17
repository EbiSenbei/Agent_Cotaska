## 変更ID

CHG-102

## 変更内容

AI チャットの連携先を設定画面で「Codex / Claude Code」から選択できるようにし、選択に応じてチャットが動作する仕様を追加する。Claude Code の認証方式は **2系統**を用意する:
- **ローカルサブスク認証**（`~/.claude/`）… **個人利用限定・配布版には含めない**。
- **クラウドプロバイダ(Amazon Bedrock)**（`CLAUDE_CODE_USE_BEDROCK=1` + AWS 資格情報）… 規約クリーンで **配布可**。従量課金。

## 変更理由

- 現在 AI チャットは Codex SDK 固定。Claude Code も選択肢として使いたい。
- Claude はサブスク認証を第三者**配布**アプリで使うことが規約で禁止されているため、ローカルサブスク認証は**個人利用（配布しない）前提**でのみ実装する。Cotaska は認証情報を保持しない。
- 一方で **Bedrock 経由**は Anthropic が第三者アプリに公式サポートする認証パスであり、**配布アプリでも規約上クリーン**。当初要件「API キー不要のログイン認証」は満たさない（AWS 従量課金・セットアップ要）が、規約リスクをゼロにできる選択肢として用意する。
- 詳細な経緯・規約調査は `00_mgmt/91_検討事項/20260713_01_ClaudeCode連携（個人利用前提）.md`、`workspace/temp/20260713_01_ClaudeCode連携の検討/認証方式とToS調査結果.md` を参照。

## 設計方針（確定事項 2026-07-13）

設計本体は `data/tasks/T-0436.md` の「設計本体」を正とする。要点は以下。

- **プロバイダ抽象化**: `aiProviderRegistry` を新設し、`provider`（codex/claude）で `codexSdkService` / `claudeCodeService`（同一シグネチャ）へディスパッチする。プロバイダ依存は IPC の5メソッドのみ。DB(aiService)・UI・参照ファイルは共用。
- **settings.yaml はプロバイダ別ネスト**: 権限・AI速度・モデルは Codex/Claude 各自に持つ。共通項目（workdir / referenceSendMode / maxReference* / diagnosticsEnabled / retentionDays）は `aiChat` 直下。既存のフラットキーは `aiChat.codex.*` へ後方互換移行する。
- **実装スコープ**: ローカルサブスク認証 と Bedrock の両方式をフル実装。ただし PoC 検証済みは Bedrock のみ、ローカルは確認タスクで実機検証（`workspace/temp/20260713_02_ClaudeSDK_PoC/PoC結果メモ.md`）。
- **AWS資格情報**: `awsProfile` 名のみ保存し、実体は AWS CLI/SDK の `~/.aws` に委ねる（アクセスキー等は保存しない）。
- **配布ビルド判定**: `app.isPackaged === true` のときローカルサブスク認証を無効化/非表示にし、Bedrock のみ選択可。
- **キャンセル差異（PoC発見）**: Claude は abort 時に例外を投げず result 未受信でストリーム終了する。claudeCodeService は「result 未受信で終了＝中断」と判定する。
- **ストリーミング**: Claude は `system(init) → assistant → result`。Codex の event へマッピングし、UI 側 payload・返却スキーマは両プロバイダで統一。

## 影響範囲

- UI: 設定画面（SettingsPane.jsx）を3グループ（AI共通 / AI-Codex関連 / AI-ClaudeCode関連）で表示。「連携先」セレクトで Codex/Claude グループを出し分け。Claude 選択時は「認証方式」セレクト（ローカル / クラウドプロバイダ(Bedrock)）と、Bedrock 用の入力欄（リージョン / モデル ID / AWS プロファイル名）を表示。モック `10_docs/20_設計/30_画面モック/settings_ai_provider_mock.html` 準拠。AiChatPane.jsx は返却スキーマ統一により原則変更なし。
- DB: 変更なし（`aiService` / `ai.sqlite` は両プロバイダ共用）。
- API/IPC: `aiChat:sendMessage` / `checkAuthStatus` / `cancelRun` / `listActiveRuns` / `listRunEvents` を `aiProviderRegistry` 経由の provider ディスパッチへ変更。返却スキーマは両プロバイダで統一。DB系ハンドラは変更なし。
- 既存機能影響: Codex 連携は既定 provider として現状維持。provider 未設定/不正値は "codex" にフォールバックするため、既存ユーザーへの影響なし。
- 設定: `settings.yaml` の `aiChat` をプロバイダ別ネスト化（`aiChat.provider` / `aiChat.codex.*` / `aiChat.claude.*`）。既存フラットキーは `aiChat.codex.*` へ後方互換移行。AWS 資格情報は保存せず `awsProfile` 名のみ保存。
- 配布: 認証モードで配布可否が異なる。**ローカルサブスク認証は個人利用限定・配布ビルドで無効化/非表示**（`app.isPackaged` 判定）。**Bedrock モードは配布可**。

### 影響ファイル一覧

| ファイル | 変更 |
|---|---|
| `20_app/src/main/aiProviderRegistry.js` | 新設（ディスパッチャ） |
| `20_app/src/main/claudeCodeService.js` | 新設（Claude連携本体） |
| `20_app/src/main/codexSdkService.js` | 参照ファイル/activeRequests の共通ロジックを共通モジュールへ切り出し（挙動不変） |
| `20_app/src/main/settingsService.js` | `aiChat` ネスト化・移行ロジック・Bedrock必須バリデーション追加 |
| `20_app/src/main/main.js` | aiChat:* 5ハンドラを provider ディスパッチへ変更 |
| `20_app/src/renderer/components/SettingsPane.jsx` | 3グループUI・連携先/認証方式セレクト・Bedrock必須チェック |
| `20_app/package.json` | `@anthropic-ai/claude-agent-sdk` 追加、asar.unpacked 設定 |

## 設計反映先

- data/tasks/T-0436.md「設計本体」（本CHGの設計正本）
- 00_mgmt/91_検討事項/20260713_01_ClaudeCode連携（個人利用前提）.md（検討本体）
- 10_docs/20_設計/30_画面モック/settings_ai_provider_mock.html（設定画面モック）
- 10_docs/20_設計/20_基本設計/08_設定画面.md（実装後にプロバイダ選択・認証方式を反映）
- 10_docs/20_設計/10_システム設計/システム全体設計.md（AI連携のプロバイダ抽象化を反映）

## 実装タスク分解

- **T-0439** CHG-102 親タスク（設計 / 実装 / ユーザ確認の3工程）
  - **T-0436** 設計: AIプロバイダ抽象化（aiProviderRegistry）と Claude 認証2系統（ローカル / Bedrock）・配布可否方針。設計本体を記載済み。
    - **T-0440** 設計PoC: Claude Agent SDK 動作検証（完了）
  - **T-0437** 実装: claudeCodeService 新設（ローカル/Bedrock 認証切替）・provider 切替・settings ネスト化と移行・設定画面3グループUI
  - **T-0438** ユーザ確認: Codex / Claude（ローカル・Bedrock）で送受信・キャンセル・認証チェックが動作し、配布版でローカル認証が無効化されること

## 完了条件

- [ ] 設定画面で「連携先」を Codex / Claude Code から選択できる
- [ ] Claude 選択時、「認証方式」を ローカル / クラウドプロバイダ(Bedrock) から選択できる
- [ ] Claude（ローカル認証）で、ローカルの Claude Code 認証でチャット（ストリーミング）が動作する
- [ ] Claude（Bedrock）で、AWS 資格情報 + `CLAUDE_CODE_USE_BEDROCK=1` によりチャット（ストリーミング）が動作する
- [ ] Codex 選択時、従来どおり動作する（デグレなし）
- [ ] `sendMessage` / `checkAuthStatus` / `cancelRun` / `listActiveRuns` / `listRunEvents` が provider に応じてディスパッチされる
- [ ] 返却スキーマが両プロバイダで統一され、UI が provider を意識せず扱える
- [ ] 配布ビルドでは Claude のローカルサブスク認証が無効化/非表示になり、Bedrock モードのみ選択できる
- [ ] AWS 資格情報が平文保存されず、awsProfile 名のみ保存される
- [ ] 既存の settings.yaml（旧フラットキー）が新ネスト構造へ後方互換移行され、既存ユーザー設定が壊れない
- [ ] Bedrock 選択時に region / modelId / awsProfile の3項目が必須チェックされ、未入力時は保存できない

## テスト観点

- [ ] provider 未設定/不正値のとき "codex" にフォールバックする
- [ ] claudeAuthMode 未設定/不正値のとき "local" にフォールバックする
- [ ] Claude（ローカル認証）で送信・逐次表示・最終応答・キャンセルが動作する
- [ ] Claude（Bedrock）で送信・逐次表示・最終応答・キャンセルが動作する
- [ ] Claude 未認証時（ローカル）に checkAuthStatus が適切なエラー/要ログインを返す
- [ ] Bedrock 資格情報不備時に checkAuthStatus が適切なエラーを返す
- [ ] sandboxMode → permissionMode のマッピングが意図どおり
- [ ] 参照ファイル送付が Claude でも機能する
- [ ] Codex 側の既存動作にデグレがない
- [ ] 配布ビルドでローカルサブスク認証が選択できない（Bedrock のみ）
- [ ] 既存 settings.yaml の後方互換移行（旧フラット→新ネスト、部分欠損時のフォールバック）
- [ ] Bedrock 必須3項目のバリデーション（未入力で保存拒否）

## 状態

進行中（設計完了 / 実装未着手）

- 設計（T-0436）: 完了。設計本体を T-0436 に記載。
- 設計PoC（T-0440）: 完了。Bedrock 動作確認済み、ローカル認証は未検証。
- 実装（T-0437）: 未着手。
- ユーザ確認（T-0438）: 未着手。
