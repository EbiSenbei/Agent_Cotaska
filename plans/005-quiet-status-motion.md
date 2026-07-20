# 005 — 反復するbox-shadowアニメーションを除去する

- **Status**: DONE
- **Commit**: 5ead4d9
- **Severity**: MEDIUM
- **Category**: Performance & cohesion
- **Estimated scope**: 2 CSS files、約25行

## Problem

更新通知とAI処理中ドットが`box-shadow`を無限に補間し、常時paintを発生させるうえ、業務アプリとして視覚的に強い。

```css
/* 20_app/src/renderer/App.css:269 — current */
animation: update-alert-pulse 1.8s ease-out infinite;

/* 20_app/src/renderer/styles/ai-chat.css:1161-1173 — current */
@keyframes ai-thinking-pulse {
  0% { transform: scale(.86); box-shadow: 0 0 0 0 rgba(45, 120, 183, .35); }
  70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(45, 120, 183, 0); }
  100% { transform: scale(.86); box-shadow: 0 0 0 0 rgba(45, 120, 183, 0); }
}
```

## Target

- 更新通知は橙色ボタンと赤い状態ドットだけを残し、無限pulseとkeyframesを削除する。
- AI処理中は`opacity: .45`から`opacity: 1`だけを1.2秒で反復し、transformとbox-shadowをアニメーションしない。

```css
@keyframes ai-thinking-pulse {
  0%, 100% { opacity: .45; }
  50% { opacity: 1; }
}
```

## Repo conventions to follow

- Cotaskaの性格は「静かで、速く、信頼できる」。永続通知は静的に、実行中状態だけを穏やかに反復させる。
- 動かす場合は`transform`または`opacity`だけを使う。

## Steps

1. `App.css`から更新通知のanimation宣言と`update-alert-pulse` keyframesを削除する。
2. 更新通知の既存色、枠、赤点を維持する。
3. `ai-chat.css`のthinking keyframesをopacity-onlyへ変更し、静的box-shadow初期値を削除する。

## Boundaries

- 更新有無やAI実行状態の判定を変更しない。
- spinnerの回転は004のreduced-motion対応以外では維持する。
- 新たなbounce、blur、glowを追加しない。

## Verification

- **Mechanical**: 対象keyframes内に`box-shadow`がない。`npm run build`が成功する。
- **Feel check**: 更新通知は見落とさないが脈動せず、AI処理中はドットの濃淡だけが静かに変化することを確認する。
- **Done when**: 反復アニメーションがtransform/opacity以外を補間しない。
