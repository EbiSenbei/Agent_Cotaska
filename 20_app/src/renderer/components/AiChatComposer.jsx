import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_COMPOSER_KEYBOARD_STEP,
  AI_COMPOSER_MIN_HEIGHT,
  clampAiComposerHeight,
  getAiComposerMaxHeight,
} from "./aiChatComposerUtils";

export default function AiChatComposer({
  draft,
  isSending,
  isDragOver,
  references,
  model,
  modelOptions,
  isModelSelectionDisabled,
  sandboxMode,
  sandboxOptions,
  referenceSendMode,
  referenceSendOptions,
  resizeResetKey,
  onDraftChange,
  onDraftKeyDown,
  onDragOver,
  onDragLeave,
  onDrop,
  onAddReferences,
  onReferenceClick,
  onReferenceKeyDown,
  onRemoveReference,
  onModelChange,
  onSandboxModeChange,
  onReferenceSendModeChange,
  onSend,
  onCancel,
}) {
  const [inputHeight, setInputHeight] = useState(AI_COMPOSER_MIN_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStateRef = useRef(null);
  const wasSendingRef = useRef(isSending);

  const getViewportHeight = () => window.innerHeight || document.documentElement.clientHeight;
  const resetInputHeight = useCallback(() => {
    resizeStateRef.current = null;
    setIsResizing(false);
    setInputHeight(AI_COMPOSER_MIN_HEIGHT);
  }, []);

  useEffect(() => {
    resetInputHeight();
  }, [resizeResetKey, resetInputHeight]);

  useEffect(() => {
    if (wasSendingRef.current && !isSending) resetInputHeight();
    wasSendingRef.current = isSending;
  }, [isSending, resetInputHeight]);

  useEffect(() => {
    const clampToViewport = () => {
      setInputHeight((current) => clampAiComposerHeight(current, getViewportHeight()));
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const handleResizePointerDown = (event) => {
    if (isSending || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: inputHeight,
    };
    setIsResizing(true);
  };

  const handleResizePointerMove = (event) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const dragDistance = resizeState.startY - event.clientY;
    setInputHeight(clampAiComposerHeight(
      resizeState.startHeight + dragDistance,
      getViewportHeight(),
    ));
  };

  const finishResize = (event) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStateRef.current = null;
    setIsResizing(false);
  };

  const handleResizeKeyDown = (event) => {
    if (isSending) return;
    let nextHeight = inputHeight;
    if (event.key === "ArrowUp") nextHeight += AI_COMPOSER_KEYBOARD_STEP;
    else if (event.key === "ArrowDown") nextHeight -= AI_COMPOSER_KEYBOARD_STEP;
    else if (event.key === "Home") nextHeight = AI_COMPOSER_MIN_HEIGHT;
    else if (event.key === "End") nextHeight = getAiComposerMaxHeight(getViewportHeight());
    else return;
    event.preventDefault();
    setInputHeight(clampAiComposerHeight(nextHeight, getViewportHeight()));
  };

  const maximumInputHeight = getAiComposerMaxHeight(getViewportHeight());

  return (
    <footer
      className={`ai-compose${isSending ? " ai-compose--sending" : ""}${isDragOver ? " ai-compose--drag-over" : ""}${isResizing ? " ai-compose--resizing" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="ai-compose-resize-handle"
        role="separator"
        aria-label="入力欄の高さを変更"
        aria-orientation="horizontal"
        aria-valuemin={AI_COMPOSER_MIN_HEIGHT}
        aria-valuemax={maximumInputHeight}
        aria-valuenow={inputHeight}
        aria-disabled={isSending}
        tabIndex={isSending ? -1 : 0}
        title="上へドラッグして入力欄を広げる"
        onDoubleClick={resetInputHeight}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />
      <textarea
        value={draft}
        disabled={isSending}
        onChange={onDraftChange}
        onKeyDown={onDraftKeyDown}
        placeholder="フォローアップの変更を求める"
        style={{ height: `${inputHeight}px` }}
      />
      {references.length > 0 && (
        <div className="ai-compose-attachments" aria-label="添付ファイル">
          {references.map((reference) => (
            <span key={reference.id} className="ai-compose-attachment" title={reference.filePath || reference.label} role="button" tabIndex={0} onClick={() => onReferenceClick(reference)} onKeyDown={(event) => onReferenceKeyDown(event, reference)}>
              <span className="ai-compose-attachment-icon">F</span>
              <span className="ai-compose-attachment-name">{reference.label}</span>
              <button type="button" onClick={(event) => { event.stopPropagation(); onRemoveReference(reference.id); }} disabled={isSending} aria-label={`${reference.label}を外す`} title="添付を外す">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="ai-compose-toolbar">
        <button type="button" className="ai-compose-icon-btn" onClick={onAddReferences} disabled={isSending} title="ファイル添付" aria-label="ファイル添付">＋</button>
        <label className="ai-model-control" title={isModelSelectionDisabled ? "Bedrockのモデルは設定画面で変更します" : "選択すると既定モデルも変更されます"}>
          <span>モデル</span>
          <select value={model} disabled={isSending || isModelSelectionDisabled} aria-label="AIモデル" onChange={onModelChange}>
            {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="ai-permission-control" title="権限設定">
          <span>ⓘ</span>
          <select value={sandboxMode} disabled={isSending} aria-label="権限設定" onChange={onSandboxModeChange}>
            {sandboxOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="ai-permission-control" title="参照ファイル送信">
          <span>添</span>
          <select value={referenceSendMode} disabled={isSending} aria-label="参照ファイル送信" onChange={onReferenceSendModeChange}>
            {referenceSendOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <span className="ai-compose-spacer" />
        <button type="button" className={`ai-send-button${isSending ? " is-sending" : ""}`} onClick={isSending ? onCancel : onSend} disabled={!isSending && !draft.trim()} title={isSending ? "中断" : "送信"} aria-label={isSending ? "AI処理を中断" : "送信"}>{isSending ? "■" : "↑"}</button>
      </div>
    </footer>
  );
}
