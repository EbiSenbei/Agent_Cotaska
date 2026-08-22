import React, { useEffect, useRef, useState } from "react";

const GUIDE_STEPS = [
  { title: "Cotaskaへようこそ", body: "Cotaskaは、Markdownを正本にしてタスクを整理できるデスクトップアプリです。まずは主要な操作だけ確認しましょう。", icon: "👋" },
  { title: "タスクをすばやく追加", body: "一覧上部の入力欄へタスク名を入力してEnterを押します。Ctrl+Kで入力欄へすぐ移動できます。", icon: "＋" },
  { title: "入力と同時に整理", body: "「明日」「~リスト名」「#タグ」「!高」をタスク名と一緒に入力すると、期限・リスト・タグ・優先度をまとめて設定できます。", icon: "⌨" },
  { title: "詳細は自動保存", body: "タスクを選ぶと右側で詳細を編集できます。タイトルと本文は入力後に自動保存されます。", icon: "✎" },
  { title: "ドラッグして整理", body: "タスク行のハンドルをドラッグすると並び替えや親子変更ができます。誤操作したときは表示される「元に戻す」を使えます。", icon: "↕" },
  { title: "安全に使い続ける", body: "削除したタスクはゴミ箱から復元できます。設定画面ではバックアップの作成と、このガイドの再表示ができます。", icon: "✓" },
];

function OnboardingGuide({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const closeButtonRef = useRef(null);
  const step = GUIDE_STEPS[stepIndex];
  const isLast = stepIndex === GUIDE_STEPS.length - 1;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.("skip");
      if (event.key === "ArrowRight") setStepIndex((current) => Math.min(current + 1, GUIDE_STEPS.length - 1));
      if (event.key === "ArrowLeft") setStepIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="onboarding-overlay" role="presentation">
      <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button ref={closeButtonRef} type="button" className="onboarding-close" aria-label="ガイドを閉じる" onClick={() => onClose?.("skip")}>×</button>
        <div className="onboarding-icon" aria-hidden="true">{step.icon}</div>
        <div className="onboarding-step">{stepIndex + 1} / {GUIDE_STEPS.length}</div>
        <h2 id="onboarding-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="onboarding-dots" aria-label={`全${GUIDE_STEPS.length}ステップ中${stepIndex + 1}番目`}>
          {GUIDE_STEPS.map((item, index) => <span key={item.title} className={index === stepIndex ? "active" : ""} />)}
        </div>
        <div className="onboarding-actions">
          <button type="button" className="onboarding-secondary" onClick={() => onClose?.("skip")}>スキップ</button>
          <div className="onboarding-nav-actions">
            <button type="button" className="onboarding-secondary" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => current - 1)}>戻る</button>
            <button type="button" className="onboarding-primary" onClick={() => isLast ? onClose?.("complete") : setStepIndex((current) => current + 1)}>
              {isLast ? "始める" : "次へ"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default OnboardingGuide;

