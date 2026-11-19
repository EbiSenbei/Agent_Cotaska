# T-0861 Codex新モデル・依存更新・0.5.3検証

実施日: 2026-11-19。変更: CHG-159。

## 範囲と実装

モデル選択肢へgpt-6.2-sol/astraを追加し、共通メタデータcodexDefaultModelからMain/Rendererの自動モデルを解決。既存明示モデルは保持し、対応表でlow/medium/highを許可。既存の送信キュー・認証・DB/IPC形式は維持する。

採用版・生成物・検証結果は同日0.5.3リリースノートに記載。SDKは完全固定。sql.jsは調査開始時の1.16.0から当日公開の1.17.0へ最新版を再確認し、本体/setupで揃えて実DB保存テストを通した。

## 間接依存

最初の監査はmoderate8件。Hono4.13.19、@hono/node-server2.1.9を親MCP SDKの許容範囲で更新。minimatch@>=7 <11のみ11.0.9へoverrideした。3/5系の呼出し契約は変更しない。11系のmakeRe等削除を公式changelogと使用側コードで確認し、app-builder-libの利用APIがMinimatch/set/matchであることを確認。Windowsパッケージを実ビルドし、Main/Rendererと依存12部品の全照合、map/依存testディレクトリの除外も検証した。全依存・本番・setup監査は0件。

## 作業環境・再現性

Node24.22.3公式ZIPをSHASUMS256.txtのSHA-256と照合してリポジトリ外v24.22.3へ配置。npm11.21.3を当該ランタイムだけに導入し、システムPATHは変更しない。manifest・.nvmrc・ランタイム下限・導入スクリプト・CI・構成/配布資料を整合した。

別作業がElectronを使用中だったため最初のnpm installはEBUSYで停止。その後独立コピーで依存と配布物を構築し、別作業のElectron終了後に元の開発フォルダの本体/setupも正常に再インストールした。元フォルダとビルド元のロックエントリ一致を確認。

今回だけの独立コピーは47ファイル220テスト成功。別作業を含む現作業フォルダの統合テストも48ファイル237テスト成功。配布物は別作業のmain.js/App.jsx/rendererStartup修正を含めない。初回配布CLIは15秒制限を超えたが60秒の再検査で両CLIのバージョン取得に成功。配布アプリ初回は読込まで約61秒、再検査は1.8秒・正常終了。原因は未特定であり起動不具合解消の証明には用いない。

## 記録・残件

ログ・公式レジストリ比較・変更前manifest/lock・監査JSON・6画面検証結果・実モデル応答・配布照合JSON・ビルドログはリポジトリ外workspace/T-0861に保存。元ソースの差分は保持し、外部公開・インストール・コミット/pushは未実施。ユーザー確認T-0865と親T-0861は未完了。

既存警告: Viteの500KB超chunk、electron-builderの重複依存参照、electron-winstallerの未承認install script、rceditのdeprecated。いずれも許可設定を拡張せずWindows NSIS生成成功。

## 公式根拠

- https://learn.chatgpt.com/docs/whats-new/gpt-62-astra-sol
- https://developers.openai.com/api/docs/guides/latest-model
- https://releases.electronjs.org/release/v44.11.5
- https://nodejs.org/en/blog/release/v24.22.3/
- https://registry.npmjs.org/
- https://github.com/isaacs/minimatch/blob/main/changelog.md

ビルドの基準コミット（git archiveから復元）: `92b2cc9083418f08501830a25835da2aded11cf0`。
