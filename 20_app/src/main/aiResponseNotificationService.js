const { Notification } = require("electron");

const notifiedRequestIds = new Set();
let activeThreadId = null;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createPreview(value, maxLength = 160) {
  const text = normalizeText(value);
  if (!text) return "AIから返信がありました。";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function setActiveThread(threadId) {
  activeThreadId = typeof threadId === "string" && threadId.trim() ? threadId.trim() : null;
}

function notifyAiResponse({ requestId, thread, assistantMessage, onClick } = {}) {
  const threadId = String(thread?.thread_id || thread?.id || "").trim();
  const notificationKey = String(requestId || assistantMessage?.message_id || "").trim();
  if (!threadId || !notificationKey || threadId === activeThreadId || !Notification.isSupported()) return false;
  if (notifiedRequestIds.has(notificationKey)) return false;

  notifiedRequestIds.add(notificationKey);
  if (notifiedRequestIds.size > 1000) notifiedRequestIds.clear();

  try {
    const notification = new Notification({
      title: "Cotaska: AIから返信がありました",
      body: `${normalizeText(thread?.title) || "AIチャット"}\n${createPreview(assistantMessage?.content)}`,
      silent: false,
    });
    notification.on("click", () => {
      try {
        onClick?.(threadId);
      } catch (_error) {
        // 通知クリックの画面遷移失敗は、保存済みのAI返信に影響させない。
      }
    });
    notification.show();
    return true;
  } catch (_error) {
    // OS通知の失敗はAI返信処理を失敗させない。
    return false;
  }
}

module.exports = {
  setActiveThread,
  notifyAiResponse,
};
