# 004 — reduced motionの代替表示を追加する

- **Status**: DONE
- **Commit**: 5ead4d9
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 3 CSS/HTML files、約30行

## Problem

起動中バー、AIスレッドspinner、AI処理中pulseに無限アニメーションがあるが、`prefers-reduced-motion`に対応していない。

```css
/* 20_app/src/renderer/styles/ai-chat.css:283-289 — current */
.ai-thread-running-spinner {
  border-radius: 999px;
  animation: ai-thread-spin .85s linear infinite;
}
```

## Target

```css
@media (prefers-reduced-motion: reduce) {
  .startup-progress::after,
  .ai-thread-running-spinner,
  .ai-message--streaming::after,
  .ai-thinking-dot {
    animation: none;
  }
}
```

移動は止めるが、色、リング、ドット、百分率などの静的状態表示は残す。決定進捗は位置移動を伴わないscaleXのため、時間を短縮して状態理解を保つ。

## Repo conventions to follow

- reduced motionは「すべて消す」ではなく、移動・反復を静的な状態表示へ置換する。
- React分岐を増やさず、plain CSSのmedia queryで処理する。

## Steps

1. `App.css`へ起動中バーと決定進捗のreduced-motion規則を追加する。
2. `styles/ai-chat.css`へspinnerとpulseの静止規則を追加する。
3. Reactマウント前に表示される`20_app/src/renderer/index.html`内styleにも同じ起動バー規則を追加する。
4. 状態表示の色・形・テキストは残す。

## Boundaries

- `animation: none !important`の全画面一括指定をしない。
- AI処理中、起動中、更新中という状態自体を非表示にしない。
- 新規依存関係を追加しない。

## Verification

- **Mechanical**: `rg -n "prefers-reduced-motion" 20_app/src/renderer`でApp.css、ai-chat.css、index.htmlが見つかる。`npm run build`が成功する。
- **Feel check**: DevTools Renderingでreduced motionを有効にし、移動・点滅が止まっても各状態を識別できることを確認する。
- **Done when**: 全無限アニメーションに穏やかな代替表示がある。
