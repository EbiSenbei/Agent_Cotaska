# CHG-116 Animation plans

Cotaskaの操作感を「静かで、速く、信頼できる」に揃えるため、T-0509で採用された6件を実装可能な単位へ分割した計画である。

| No. | Plan | Severity | Status | Dependency |
| --- | --- | --- | --- | --- |
| 001 | [共通モーショントークンを導入する](001-motion-tokens.md) | LOW | DONE | なし |
| 002 | [サイドバーのtransition対象を限定する](002-sidebar-transition.md) | HIGH | DONE | 001 |
| 003 | [進捗表示をtransform駆動へ変更する](003-transform-progress.md) | MEDIUM | DONE | 001 |
| 004 | [reduced motionの代替表示を追加する](004-reduced-motion.md) | MEDIUM | DONE | 003、005 |
| 005 | [反復するbox-shadowアニメーションを除去する](005-quiet-status-motion.md) | MEDIUM | DONE | 001 |
| 006 | [直接操作中のフィードバックを統一する](006-direct-manipulation-feedback.md) | MEDIUM | DONE | 001 |

推奨実行順は `001 → 002 → 003 → 005 → 004 → 006` とする。001は後続計画が参照する共通値、004は最終的な反復アニメーション集合を対象とするため、この順序を維持する。
