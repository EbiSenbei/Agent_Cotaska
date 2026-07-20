# 001 — 共通モーショントークンを導入する

- **Status**: DONE
- **Commit**: 5ead4d9
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 3 CSS files、約15行

## Problem

時間とイージングが複数ファイルへ直接記述され、同じ意味の反応が`.12s`、`.15s`、`.2s`などに分散している。

```css
/* 20_app/src/renderer/styles/ai-chat.css:266 — current */
transition: opacity .12s ease;

/* 20_app/src/renderer/App.css:139 — current */
transition: background 0.15s;
```

## Target

`20_app/src/renderer/App.css`の`:root`へ次を定義し、既存の短いUI transitionから参照する。

```css
:root {
  --motion-instant: 100ms;
  --motion-fast: 120ms;
  --motion-standard: 160ms;
  --motion-progress: 200ms;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

## Repo conventions to follow

- グローバルなrendererスタイルは`20_app/src/renderer/App.css`から読み込まれている。
- 高頻度の背景・透明度変更は100〜120ms、標準UIは160ms、進捗補間は200msとする。
- CSS依存関係を増やさず、既存のplain CSS構成を維持する。

## Steps

1. `20_app/src/renderer/App.css`先頭へ上記`:root`を追加する。
2. `App.css`、`styles/app-components.css`、`styles/ai-chat.css`の既存transition時間を意味の近いトークンへ置換する。
3. 高頻度の選択・ナビゲーションへ新しい移動アニメーションを追加しない。

## Boundaries

- DOM構造、React state、色、サイズを変更しない。
- 新規依存関係を追加しない。
- 300ms以上のUI transitionを追加しない。
- コードがCommit `5ead4d9`から大きく変わっている場合は推測で置換しない。

## Verification

- **Mechanical**: `npm test`と`npm run build`が成功する。
- **Feel check**: サイドバー、タスク行、AIアクションを通常速度とDevTools 10%再生で確認し、既存より遅く感じない。
- **Done when**: rendererの短時間transitionが共通トークンを参照し、直接記述が意図的な反復周期だけになっている。
