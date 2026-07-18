import React, { useMemo } from "react";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const TASK_ID_PATTERN = /\bT-\d{4}\b/g;

markdown.core.ruler.after("inline", "cotaska_task_links", (state) => {
  state.tokens.forEach((blockToken) => {
    if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) return;
    const children = [];
    blockToken.children.forEach((token) => {
      if (token.type !== "text") return children.push(token);
      const text = token.content || "";
      let cursor = 0;
      for (const match of text.matchAll(TASK_ID_PATTERN)) {
        const taskId = match[0];
        const index = match.index || 0;
        if (index > cursor) {
          const textToken = new state.Token("text", "", 0);
          textToken.content = text.slice(cursor, index);
          children.push(textToken);
        }
        const linkToken = new state.Token("html_inline", "", 0);
        linkToken.content = `<button type="button" class="ai-task-link" data-task-id="${taskId}">${taskId}</button>`;
        children.push(linkToken);
        cursor = index + taskId.length;
      }
      if (cursor < text.length) {
        const textToken = new state.Token("text", "", 0);
        textToken.content = text.slice(cursor);
        children.push(textToken);
      }
    });
    blockToken.children = children;
  });
});

export function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function AiMarkdownPreview({ content, error, onOpenTask, onOpenLink, onOpenLinkContextMenu }) {
  const html = useMemo(() => markdown.render(String(content || "")), [content]);
  return <div className={`ai-message-markdown${error ? " ai-message-error" : ""}`} onClick={(event) => {
    const taskLink = event.target.closest?.("[data-task-id]");
    if (taskLink) { event.preventDefault(); onOpenTask?.(taskLink.getAttribute("data-task-id")); return; }
    const anchor = event.target.closest?.("a[href]");
    if (!anchor) return;
    event.preventDefault(); onOpenLink?.(anchor.getAttribute("href"));
  }} onContextMenu={(event) => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor) return;
    event.preventDefault(); onOpenLinkContextMenu?.(anchor.getAttribute("href"), event.clientX, event.clientY);
  }} dangerouslySetInnerHTML={{ __html: html }} />;
}
