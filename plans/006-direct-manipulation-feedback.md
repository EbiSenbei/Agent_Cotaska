# 006 — 直接操作中のフィードバックを統一する

- **Status**: DONE
- **Commit**: 5ead4d9
- **Severity**: MEDIUM
- **Category**: Physicality & direct manipulation
- **Estimated scope**: 5 files、約50行

## Problem

AIコンテキスト幅はドラッグ中のハンドル強調を維持する一方、ナビ、詳細、サブタスクのリサイズハンドルはhoverを外れると強調が消える。windowがfocusを失った場合の終了処理も統一されていない。

```css
/* 20_app/src/renderer/styles/ai-chat.css:1507-1509 — current exemplar */
.ai-right-resize-handle:hover::after,
.ai-chat-screen--resizing-context .ai-right-resize-handle::after {
  background: rgba(45, 120, 183, .45);
}
```

```js
// 20_app/src/renderer/App.jsx:146 — current
const onUp = () => { resizeDragRef.current = null; };
```

## Target

- pointer-down直後から終了まで操作中classを保持する。
- moveは既存どおりポインター差分へ1対1で追従し、補間を加えない。
- `mouseup`とwindow `blur`のどちらでも操作中状態を解除する。
- タスク並び替えはHTML5 Drag & Dropのままとし、drag元、挿入線、子化、禁止状態を既存classで明示する。

```css
.resize-handle--active,
.resize-handle--detail.resize-handle--active::after,
body.is-resizing-detail-sections .detail-section-resize-handle::after {
  /* 各ハンドルの現在の青系active色を維持 */
}
```

## Repo conventions to follow

- `AiChatPane.jsx`の`isResizingContextPanel`と`.ai-chat-screen--resizing-context`を正しい実装例とする。
- CHG-088のHTML5 Drag & Drop方式を維持する。
- リサイズ値はnav 160〜480px、detail既存min/max、subtask既存min/maxを変えない。

## Steps

1. `App.jsx`へnav/detailの操作中stateと共通終了関数を追加し、`mouseup`と`blur`で解除する。
2. nav/detailハンドルへactive classを付け、`App.css`でhoverと同じ強調を操作終了まで維持する。
3. `DetailPane.jsx`の終了処理を`blur`にも登録し、body classを必ず解除する。
4. `app-components.css`でbody class中のサブタスクハンドルを強調する。
5. `AiChatPane.jsx`も`blur`でリサイズを終了し、mousemove/mouseup/blur listenerをすべて解除する。
6. `app-components.css`でdrag元のハンドルをdrag中も表示し、既存drop-before/drop-after/drop-child/drop-invalidを維持する。

## Boundaries

- Pointer Eventsやmotion libraryへ置換しない。
- momentum、spring、rubber-bandingを追加しない。デスクトップペイン幅は1対1追従を優先する。
- 並び替え、親子化、仮想化、保存ロジックを変更しない。
- 新規依存関係を追加しない。

## Verification

- **Mechanical**: `npm test`と`npm run build`が成功する。
- **Feel check**: nav、detail、subtask、AI contextをそれぞれドラッグし、ハンドル強調がpointerから外れても維持されること、window切替で解除されることを確認する。タスクdragの4状態も実機で確認する。
- **Done when**: 全リサイズが即時・1対1で追従し、mouseup/blur後にcursorやactive表示が残らない。
