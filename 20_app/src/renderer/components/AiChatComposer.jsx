import React from "react";

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
  return (
    <footer
      className={`ai-compose${isSending ? " ai-compose--sending" : ""}${isDragOver ? " ai-compose--drag-over" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <textarea value={draft} disabled={isSending} onChange={onDraftChange} onKeyDown={onDraftKeyDown} placeholder="フォローアップの変更を求める" />
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
