# 003 — 進捗表示をtransform駆動へ変更する

- **Status**: DONE
- **Commit**: 5ead4d9
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 4 files、約20行

## Problem

起動進捗と更新ダウンロード進捗が`width`を補間し、更新ごとにlayoutを発生させる。

```css
/* 20_app/src/renderer/App.css:90-95 — current */
.startup-progress-fill {
  width: 0;
  transition: width .28s ease;
}
```

```jsx
// 20_app/src/renderer/App.jsx:908-911 — current
<div className="startup-progress-fill"
  style={{ width: `${Math.round(startupProgress.percent)}%` }} />
```

```jsx
// 20_app/src/renderer/components/SettingsPane.jsx:491 — current
<div className="update-progress-bar" style={{ width: `${progressPercent}%` }} />
```

## Target

```css
.startup-progress-fill,
.update-progress-bar {
  width: 100%;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--motion-progress) var(--ease-out);
}
```

React inline styleは0〜1へclampした`scaleX()`の完全なtransform文字列を設定する。

## Repo conventions to follow

- 001の`--motion-progress: 200ms`と`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`を使う。
- 見た目の幅、色、角丸、百分率表示は変えない。

## Steps

1. `App.css`の2本の進捗バーを幅100%、左起点の`scaleX()`へ変更する。
2. `App.jsx`の起動進捗値を0〜100にclampし、`style.transform`へ0〜1の比率を渡す。
3. `SettingsPane.jsx`も同じ比率計算で`style.transform`を渡す。
4. aria表示と既存の条件付きrenderを維持する。

## Boundaries

- 進捗の算出ロジック、IPC、更新処理を変更しない。
- canvas、rAF、motion libraryを追加しない。
- 不確定進捗バーの移動方式は004で扱う。

## Verification

- **Mechanical**: `rg -n "transition:\\s*width|style=\\{\\{ width" 20_app/src/renderer`が対象箇所で0件。`npm test`と`npm run build`が成功する。
- **Feel check**: 起動と更新ダウンロードをDevTools 10%再生で確認し、左端が固定されたままバーが伸びることを確認する。
- **Done when**: 進捗の補間対象が`transform`のみで、0%と100%の表示が正しい。
