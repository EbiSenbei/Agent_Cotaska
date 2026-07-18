import React from "react";
import AiMarkdownPreview from "./AiMarkdownPreview";

export default function AiChatMessage({ message, onCopy, onOpenTask, onOpenLink, onOpenLinkContextMenu }) {
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
