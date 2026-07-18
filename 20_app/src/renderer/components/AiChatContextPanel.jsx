import React from "react";
import DetailPane from "./DetailPane";
import AiMarkdownPreview from "./AiMarkdownPreview";

export default function AiChatContextPanel({
  contextPanel, tasks, lists, tags, filePreviewMode, isMarkdownFile,
  onResizeStart, onClose, onOpenTask, onSelectTask, onTaskUpdated,
  onToggleComplete, onSetTaskDue, onSetTaskTags, onAddTag,
  onToggleFilePreview, onOpenFileExternal, onOpenLink, onOpenLinkContextMenu,
}) {
  if (!contextPanel) return null;
  return (
    <aside className="ai-right-pane">
      <div className="ai-right-resize-handle" role="separator" aria-orientation="vertical" aria-label="コンテキストパネル幅を変更" title="ドラッグして幅を変更" onMouseDown={onResizeStart} />
      <header className="ai-right-header">
        <div><div className="ai-right-title">{contextPanel.title || "コンテキスト"}</div><div className="ai-right-subtitle">{contextPanel.subtitle || ""}</div></div>
        <button className="ai-icon-button" type="button" title="閉じる" onClick={onClose}>×</button>
      </header>
      <div className="ai-right-body">
        {contextPanel.type === "task" && (
          <div className="ai-task-detail-panel">
            {contextPanel.task ? (
              <DetailPane key={contextPanel.task.id} task={contextPanel.task} tasks={tasks} lists={lists} tags={tags} onClose={onClose} onSelectTask={(task) => onSelectTask(task?.id)} onSaved={onTaskUpdated} onToggleComplete={onToggleComplete} onSetTaskDue={onSetTaskDue} onSetTaskTags={onSetTaskTags} onAddTag={onAddTag} />
            ) : (
              <section className="ai-info-card"><p className="ai-muted-text">タスク情報を読み込めませんでした。</p><button type="button" className="ai-panel-action" onClick={() => onOpenTask?.(contextPanel.taskId)}>リストで開く</button></section>
            )}
          </div>
        )}
        {contextPanel.type === "file" && (
          <section className="ai-file-view-card">
            <div className="ai-file-view-head">
              <h3>ファイルビュー</h3>
              <div className="ai-file-view-actions">
                {isMarkdownFile(contextPanel.file) && <button type="button" className="icon-action-btn" onClick={onToggleFilePreview} title={filePreviewMode ? "テキスト表示へ切替" : "プレビュー表示へ切替"} aria-label={filePreviewMode ? "テキスト表示へ切替" : "プレビュー表示へ切替"}>{filePreviewMode ? "✏" : "🔍"}</button>}
                <button type="button" className="icon-action-btn external" onClick={onOpenFileExternal} disabled={!contextPanel.file?.path} title="外部アプリで開く" aria-label="外部アプリで開く">↗</button>
              </div>
            </div>
            {contextPanel.status === "loading" && <p>読み込んでいます。</p>}
            {contextPanel.status === "error" && <p className="ai-muted-text">{contextPanel.error}</p>}
            {contextPanel.file?.preview_type === "text" && isMarkdownFile(contextPanel.file) && filePreviewMode && <div className="ai-file-preview-markdown"><AiMarkdownPreview content={contextPanel.file.content || ""} onOpenTask={onSelectTask} onOpenLink={(href) => onOpenLink(href, contextPanel.file?.path || "")} onOpenLinkContextMenu={(href, x, y) => onOpenLinkContextMenu(href, x, y, contextPanel.file?.path || "")} /></div>}
            {contextPanel.file?.preview_type === "text" && (!isMarkdownFile(contextPanel.file) || !filePreviewMode) && <textarea className="ai-file-preview-editor" value={contextPanel.file.content || ""} readOnly />}
            {contextPanel.file?.preview_type === "pdf" && <iframe className="ai-file-preview-pdf" src={contextPanel.file.url} title={contextPanel.file.label || "PDF"} />}
            {contextPanel.file?.preview_type === "unsupported" && <p className="ai-muted-text">このファイル形式はプレビューに対応していません。</p>}
          </section>
        )}
      </div>
    </aside>
  );
}
