# 002 — サイドバーのtransition対象を限定する

- **Status**: DONE
- **Commit**: 5ead4d9
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 CSS file、約5行

## Problem

高頻度で使うサイドバーアイコンが`all`を対象にしており、将来追加されたレイアウト・描画プロパティまで意図せず動く。

```css
/* 20_app/src/renderer/App.css:212-225 — current */
.sidebar .sb-icon {
  opacity: 0.4;
  transition: all 0.15s;
}
```

## Target

```css
.sidebar .sb-icon {
  opacity: 0.4;
  transition: opacity var(--motion-fast) ease,
              background-color var(--motion-fast) ease;
}
```

hoverによる状態変更は`@media (hover: hover) and (pointer: fine)`内に限定し、`.active`と`:focus-visible`は入力方式に関係なく即時に理解できる状態を維持する。

## Repo conventions to follow

- 001で定義する`--motion-fast: 120ms`を使用する。
- サイドバーの現在の色・透明度・active背景は維持する。

## Steps

1. `20_app/src/renderer/App.css`の`transition: all 0.15s`を対象プロパティ指定へ置換する。
2. サイドバーの`:hover`規則をhover可能かつfine pointerのmedia queryへ移す。
3. `.active`規則はmedia query外に残す。

## Boundaries

- サイドバーの選択処理、Reactコンポーネント、アイコン配置を変更しない。
- transformや押下scaleを追加しない。
- 新規依存関係を追加しない。

## Verification

- **Mechanical**: `rg -n "transition:\\s*all" 20_app/src/renderer`が0件。`npm run build`が成功する。
- **Feel check**: 各サイドバー項目を連続クリックして選択が即時に切り替わり、hoverだけが短く補間されることを確認する。
- **Done when**: `all`がなく、キーボード・クリック選択に待ち時間がない。
