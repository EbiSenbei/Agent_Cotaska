# Cotaska 紹介動画

紹介動画の完成版・台本・編集コード・素材の正式管理先。採用版は **モーショングラフィックス v3／Nemo B／60秒**（2026-10-25）。動画の版番号であり、アプリのバージョンではない。

主メッセージは「タスク管理とAIチャットを、ひとつの作業画面に。」。公式サイト・配布ページ・note・SNSなどでの製品紹介を想定する。

## 採用版

- [完成動画 MP4](10_完成版/v3/Cotaska_紹介動画_モーショングラフィックス_v3_NemoB_60秒.mp4)
- [サムネイル JPEG](10_完成版/v3/Cotaska_紹介動画_v3_NemoB_サムネイル.jpg)
- [任意字幕 SRT](10_完成版/v3/Cotaska_紹介動画_v3_NemoB_字幕.srt)
- [選定済み公開用画像・用途](../40_公開用画像/README.md)
- [現行の構成・採用仕様](20_台本/現行構成_v3.md)
- [格納と再出力の検証結果](20_台本/格納・再出力検証.json)

1920×1080／30fps／60.00秒／1,800フレーム。H.264映像、AAC音声48kHz・ステレオ。ナレーション・BGM・効果音あり。SRTは動画への字幕トラック埋め込みではなく、任意で利用する別ファイル。画面内のテロップは映像に含まれる。

## フォルダ構成

| フォルダ | 内容 |
| --- | --- |
| `10_完成版/v3/` | 利用者確認済みのMP4・サムネイル・字幕。採用時のバイト列を保持 |
| `20_台本/` | 現行構成、承認された台本、制作・修正履歴、移管・検証記録 |
| `30_編集コード/` | 現行の再出力・素材準備・BGM生成・音声生成／ミックス・検証コード |
| `40_素材/` | 元収録、切り出し映像14本と静止画、ロゴ、Nemo音声と合成クエリ、BGM、採用音声マスター |
| `90_旧版/` | 55秒操作デモ、58秒紹介動画、60秒版v1・v2、音声比較、制作当時のコード原本 |

元のT-0294添付と作業フォルダは履歴として保持した。今後の参照先はこのフォルダとする。現行コードはこのフォルダ内の素材を利用し、元の作業フォルダやタスク添付を読み込まない。
`90_旧版/制作時コード/` は当時の参照パスを含む保存用原本。実行には現行コードを使う。

## 同じ内容を再出力する

必要環境はWindows、Python 3.11以降、FFmpeg 7.1（libx264/AAC）、Pillow 12.3.0、numpy 2.3.5、WindowsのYu Gothic Medium/Bold（`YuGothM.ttc`・`YuGothB.ttc`）。フォントと実行ツールは同梱しない。
制作時のPython詳細は [移管元一覧](20_台本/移管元一覧.json) に記録した。

PowerShellで `30_編集コード` を開き、利用環境のFFmpeg実行ファイルを指定する。

```powershell
$env:FFMPEG_BIN = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
python -m pip install -r .\requirements.txt
python .\render.py
python .\verify.py
```

`FFMPEG_BIN` を省略する場合はPATH上の `ffmpeg` を使う。フォントの配置が異なる場合は `COTASKA_FONT_DIR` でフォルダを指定する。
出力先は `30_編集コード/build/`。この生成物はGit管理対象外で、完成版を自動上書きしない。既存の出力ファイルがあると停止するため、再実行時は新しい出力先を指定する。

```powershell
$env:COTASKA_VIDEO_BUILD = 'D:\VideoWork\cotaska-rebuild-02'
python .\render.py
python .\verify.py
```

`python .\render.py --preview` は静止画素材による構成確認用。最終確認には実映像での全編出力を使う。
既存音声は `40_素材/audio/approved-master.m4a` からAACを再圧縮せずコピーする。Nemoエンジンは再出力時に不要。
`verify.py` はコピーした112ファイルのハッシュ、全編デコード、採用版との全1,800映像フレーム、AACパケット、デコード後の音声サンプル一致を確認する。同じFFmpeg・フォント・ライブラリでの再現確認用で、内容を修正した新版は一致検証の対象外。

## 再編集する

| 変更対象 | 編集箇所・入口 |
| --- | --- |
| 冒頭・最後のロゴ、大きさ、ヘッダ | `30_編集コード/render.py` |
| 8場面の図解・テロップ・位置・アニメーション | `30_編集コード/render_film.py` |
| ロゴ素材 | `40_素材/logo/`。動画採用時のスナップショットを保持 |
| 収録映像の切り出し | `prepare_clips.py` のcuts。元映像・イベントは `40_素材/recordings/` |
| 音声の文言・開始時刻 | `40_素材/audio/manifest.json` のscenes。原音とクエリも同じフォルダ |
| BGM | `make_bgm.py`（新規作曲した88 BPMの音源生成コード） |

`prepare_clips.py` は `build/prepared-media/` へ切り出し映像と静止画を生成する。確認後、新版用の素材へ反映する。
`make_bgm.py` は `build/original-bgm.wav` を生成する。
`mix_audio.py` は保存済みNemo原音から正規化・時刻配置・BGM／効果音ミックスを再実行し、`build/audio/master.m4a` を生成する。原音を生成し直さずミックスだけ変更できる。

```powershell
python .\mix_audio.py
$env:COTASKA_AUDIO_MASTER = Join-Path $env:COTASKA_VIDEO_BUILD 'audio\master.m4a'
python .\render.py
```

上の例は `COTASKA_VIDEO_BUILD` を設定済みの環境用。音声を変更したら、字幕の文言・開始／終了時刻も合わせて更新し、映像とのずれ・文末切れ・音量を確認する。採用版の音声を再現するときは `COTASKA_AUDIO_MASTER` を設定せず、保存した音声マスターを使う。

文言を変えてNemoで再合成する場合は、別途インストールした **VOICEVOX Nemo Engine 0.26.0** をローカルで起動する。採用声は女声6／style 10006。エンジン本体・モデル・個人設定はこのフォルダへ含めない。

```powershell
python .\synthesize_nemo.py --engine-url http://127.0.0.1:50129
python .\mix_audio.py --voices "$env:COTASKA_VIDEO_BUILD\nemo-input"
```

原稿変更時は `--manifest` で編集用JSONを指定できる。再合成は新しい音声になるため聴取確認が必要。今回の移管では保存済み原音からの再ミックスを確認し、エンジンを再起動する新規合成は行っていない。

## 採用版を更新する手順

1. コード・素材・字幕を修正し、作業用の出力先で生成する。
2. 全編再生、画面・文字の配置、読み、音量、字幕、クレジットを確認する。
3. 利用者の確認後、`10_完成版/v4/` など新しい版へ完成物を保存する。出力ファイル名とコードの版表記も揃える。
4. このREADMEの採用版と現行構成を更新し、検証記録・`checksums.json` を更新する。過去版は保持する。

`checksums.json` は移管後の管理対象ファイルのSHA-256一覧。`build/` と一覧自身は除外する。コピー元との照合記録は `20_台本/移管元一覧.json` に分けて保持する。
Gitのコミット・pushや公開サイトへのアップロードは別工程。

## クレジットと出典

- 音声：**VOICEVOX Nemo（女声6）**。動画終盤にも表示。[Nemo利用規約](https://voicevox.hiroshiba.jp/nemo/term/)を参照し、公開時もクレジットを維持する。
- ロゴと画面：Cotaska。終盤・冒頭は案01の背景透過・白縁20px・輪郭調整版。ヘッダは制作時の公式サイトロゴ。
- BGM・効果音：この動画用の生成コードによる新規制作。ダウンロード楽曲は使用していない。
- 配色と主メッセージ：[Cotaska公式サイト](https://ebisenbei.github.io/cotaska-site/index.html)。制作時のHTML/CSSは `40_素材/reference/` に参照資料として保持。
- 実画面：独立したデモ用プロジェクトを収録。AIの実行待ちなどを短縮・切り出しした映像。親子関係の図解とMarkdownの表示は説明用の編集表現を含む。
- 元タスク：[T-0294](../../../../../00_mgmt/Cotaska_タスク管理ツール/tasks/T-0294/T-0294.md)。公開用画像4点の選定・正式格納も完了し、T-0294は完了。実掲載と導線確認は公開工程で扱う。
