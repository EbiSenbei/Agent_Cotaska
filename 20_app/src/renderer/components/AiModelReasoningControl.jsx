import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitPresence } from "../hooks/useExitPresence";

export default function AiModelReasoningControl({ model, modelOptions = [], isModelSelectionDisabled,
  reasoningEffort = "auto", reasoningLevels = [], isSpeedAuto, isSavingModelSettings,
  executionModel, onModelChange, onReasoningChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(reasoningEffort);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const trigger = useRef(null);
  const popup = useRef(null);
  const pointer = useRef(null);
  const draftRef = useRef(reasoningEffort);
  const id = useId();
  const presence = useExitPresence(open ? true : null, 150);
  const setValue = (value) => { draftRef.current = value; setDraft(value); };
  useEffect(() => { if (!isSavingModelSettings) { pointer.current = null; setValue(reasoningEffort); } }, [reasoningEffort, model, reasoningLevels.length, isSavingModelSettings]);
  const close = (restoreFocus = false) => {
    pointer.current = null;
    setValue(reasoningEffort);
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !popup.current) return undefined;
    const position = () => {
      const rect = trigger.current.getBoundingClientRect();
      const width = popup.current.getBoundingClientRect().width;
      const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
      popup.current.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
      const above = rect.top - 16;
      const below = window.innerHeight - rect.bottom - 16;
      const placeBelow = above < 180 && below > above;
      popup.current.style.top = placeBelow ? `${rect.bottom + 8}px` : "auto";
      popup.current.style.bottom = placeBelow ? "auto" : `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
      popup.current.style.maxHeight = `${Math.max(0, placeBelow ? below : above)}px`;
    };
    position();
    popup.current.querySelector("select:not(:disabled), button:not(:disabled)")?.focus();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open, presence.presentValue]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, reasoningEffort]);

  const level = reasoningLevels.find((item) => item.value === draft);
  const label = level?.label || (isSpeedAuto ? "自動・速度優先" : "自動");
  const commit = (value) => { setValue(value); onReasoningChange?.(value); };
  return <>
    <button ref={trigger} type="button" className="ai-reasoning-trigger" aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={(event) => { setKeyboardOpen(event.detail === 0); if (open) close(true); else setOpen(true); }}>
      思考：{label} <span aria-hidden="true">▾</span>
    </button>
    {presence.presentValue && createPortal(
      <div ref={popup} id={id} className={`ai-reasoning-popup${presence.isExiting ? " is-exiting" : ""}${keyboardOpen ? " is-keyboard" : ""}`}
        role="dialog" aria-label="モデルと思考量" aria-hidden={!open} inert={!open ? true : undefined}
        onTransitionEnd={presence.handleTransitionEnd}>
        <label className="ai-reasoning-model">
          <span>{isModelSelectionDisabled ? "AWSプロファイル名" : "モデル"}</span>
          <select aria-label={isModelSelectionDisabled ? "AWSプロファイル名" : "AIモデル"} value={model}
            disabled={isModelSelectionDisabled || isSavingModelSettings} onChange={onModelChange}>
            {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {isModelSelectionDisabled && <p className="ai-reasoning-help">設定画面で変更します。実行モデル：{executionModel || "未設定"}</p>}
        <div className="ai-reasoning-heading"><strong>思考量</strong><button type="button" onClick={() => close(true)} aria-label="モデルと思考量を閉じる">×</button></div>
        <button type="button" className="ai-reasoning-auto" aria-pressed={draft === "auto"}
          disabled={isSavingModelSettings} onClick={() => commit("auto")}>
          {draft === "auto" ? (isSpeedAuto ? "自動・速度優先" : "自動") : "自動に戻す"}
        </button>
        <p className="ai-reasoning-help">自動はモデル・既存設定の既定動作を使います。</p>
        {reasoningLevels.length > 0 ? <>
          <input type="range" min="0" max={reasoningLevels.length - 1} step="1"
            aria-label="思考量" aria-valuetext={level ? `${level.label}：${level.description}` : "自動（段階を選択すると手動に切替）"}
            value={Math.max(0, reasoningLevels.findIndex((item) => item.value === draft))}
            disabled={isSavingModelSettings}
            onPointerDown={(event) => {
              if (pointer.current != null || event.button !== 0) return;
              pointer.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              if (draftRef.current === "auto") setValue(reasoningLevels[0].value);
            }}
            onChange={(event) => {
              const value = reasoningLevels[Number(event.target.value)].value;
              setValue(value);
              if (pointer.current == null) onReasoningChange?.(value);
            }}
            onPointerUp={(event) => { if (pointer.current !== event.pointerId) return; pointer.current = null; onReasoningChange?.(draftRef.current); }}
            onPointerCancel={() => { pointer.current = null; setValue(reasoningEffort); }}
            onKeyDown={(event) => {
              if (draft !== "auto" || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              commit(event.key === "End" ? reasoningLevels.at(-1).value : reasoningLevels[0].value);
            }} />
          <div className="ai-reasoning-ticks">{reasoningLevels.map((item) => <button key={item.value} type="button"
            aria-pressed={draft === item.value} disabled={isSavingModelSettings} onClick={() => commit(item.value)}>{item.label}</button>)}</div>
        </> : <p className="ai-reasoning-help">このモデル・接続先では思考量の対応を確認できないため、自動を使います。</p>}
        <p className="ai-reasoning-description" aria-live="polite">{level?.description || (isSpeedAuto ? "速度優先の既定動作を使います。" : "モデル・既存設定に従います。")}</p>
        <small className="ai-reasoning-help">次の送信から適用します。送信待ちの設定は変わりません。</small>
        {isSavingModelSettings && <span role="status">保存しています…</span>}
      </div>, document.body)}
  </>;
}
