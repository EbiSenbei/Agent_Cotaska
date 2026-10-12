import React from "react";
import AiMarkdownPreview from "./AiMarkdownPreview";

export default function AiChatMessage({ message, onCopy, onOpenTask, onOpenLink, onOpenLinkContextMenu, onReferenceClick }) {
  return (
    <article className={`ai-message ai-message--${message.role}${message.streaming ? " ai-message--streaming" : ""}`}>
      <div className="ai-message-author">{message.author}</div>
      <AiMarkdownPreview
        content={message.body}
        error={message.error}
        onOpenTask={onOpenTask}
        onOpenLink={onOpenLink}
        onOpenLinkContextMenu={onOpenLinkContextMenu}
      />
      {message.attachments?.length > 0 && (
        <ul className="ai-message-attachments" aria-label="添付ファイル">
          {message.attachments.map((attachment, index) => (
            <li key={attachment.id || index} title={attachment.filePath}>
              <button type="button" disabled={!attachment.filePath} onClick={() => onReferenceClick?.(attachment)}>
                <span aria-hidden="true">📎</span>
                {attachment.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ai-message-hover-actions" aria-label="メッセージ操作">
        {message.time && <time dateTime={message.createdAt}>{message.time}</time>}
        <button
          type="button"
          className="ai-message-copy-btn"
          title="チャット内容をコピー"
          aria-label="チャット内容をコピー"
          onClick={() => onCopy(message)}
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
