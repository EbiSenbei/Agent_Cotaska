import React, { useCallback, useEffect, useRef, useState } from "react";
import AiImageThumbnail from './AiImageThumbnail';
import AiModelReasoningControl from './AiModelReasoningControl';
import {
  AI_COMPOSER_KEYBOARD_STEP,
  AI_COMPOSER_MIN_HEIGHT,
  clampAiComposerHeight,
  getAiComposerMaxHeight,
} from "./aiChatComposerUtils";

export default function AiChatComposer({
  draft,
  isSending,
  isPasting = false,
  onPaste,
  isDragOver,
  references,
  model,
  modelOptions,
  isModelSelectionDisabled,
  reasoningEffort, reasoningLevels, isSpeedAuto, isSavingModelSettings, executionModel, onReasoningChange,
  sandboxMode,
  sandboxOptions,
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
    if (wasSendingRef.current && !isSending && !draft && !resizeStateRef.current) resetInputHeight();
    wasSendingRef.current = isSending;
  }, [isSending, draft, resetInputHeight]);

  useEffect(() => {
    const clampToViewport = () => {
      setInputHeight((current) => clampAiComposerHeight(current, getViewportHeight()));
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const handleResizePointerDown = (event) => {
    if (event.button !== 0) return;
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
        tabIndex={0}
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
        onChange={onDraftChange}
        onKeyDown={onDraftKeyDown}
        onPaste={onPaste}
        placeholder="フォローアップの変更を求める"
        style={{ height: `${inputHeight}px` }}
      />
      {isPasting && <div role="status">画像を保存しています…</div>}
      {references.length > 0 && (
        <div className="ai-compose-attachments" aria-label="添付ファイル">
          {references.map((reference) => (
            <span key={reference.id} className="ai-compose-attachment" title={reference.filePath || reference.label} role="button" tabIndex={0} onClick={() => onReferenceClick(reference)} onKeyDown={(event) => onReferenceKeyDown(event, reference)}>
              {reference.filePath?.startsWith('cotaska-image:') ? <AiImageThumbnail filePath={reference.filePath} /> : <span className="ai-compose-attachment-icon">F</span>}
              <span className="ai-compose-attachment-name">{reference.label}</span>
              <button type="button" onClick={(event) => { event.stopPropagation(); onRemoveReference(reference.id); }} disabled={isSending || isPasting} aria-label={`${reference.label}を外す`} title="添付を外す">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="ai-compose-toolbar">
        <button type="button" className="ai-compose-icon-btn" onClick={onAddReferences} disabled={isSending || isPasting} title="ファイル添付" aria-label="ファイル添付">＋</button>
        <AiModelReasoningControl model={model} modelOptions={modelOptions} isModelSelectionDisabled={isModelSelectionDisabled}
          reasoningEffort={reasoningEffort} reasoningLevels={reasoningLevels} isSpeedAuto={isSpeedAuto}
          isSavingModelSettings={isSavingModelSettings} executionModel={executionModel}
          onModelChange={onModelChange} onReasoningChange={onReasoningChange} />
        <label className="ai-permission-control" title="権限設定">
          <span>ⓘ</span>
          <select value={sandboxMode} disabled={isSending || isPasting} aria-label="権限設定" onChange={onSandboxModeChange}>
            {sandboxOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <span className="ai-compose-spacer" />
        {isSending && <button type="button" className="ai-send-button" onClick={onSend} disabled={isPasting || !draft.trim()} aria-label="送信待ちに追加" title="送信待ちに追加">↑</button>}
        <button type="button" className={`ai-send-button${isSending ? " is-sending" : ""}`} onClick={isSending ? onCancel : onSend} disabled={isPasting || (!isSending && !draft.trim())} title={isSending ? "中断" : "送信"} aria-label={isSending ? "AI処理を中断" : "送信"}>{isSending ? "■" : "↑"}</button>
      </div>
    </footer>
  );
}
