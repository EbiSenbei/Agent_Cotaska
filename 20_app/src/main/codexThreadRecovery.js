const MAX_RECOVERY_MESSAGES = 12;
const MAX_RECOVERY_CONTEXT_CHARS = 12000;

function isMissingCodexRolloutError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("thread/resume failed")
    && message.includes("no rollout found for thread id");
}

function buildRecoveryTranscript(messages = [], options = {}) {
  const excludeMessageId = String(options.excludeMessageId || "");
  const maxMessages = Math.max(1, Number(options.maxMessages) || MAX_RECOVERY_MESSAGES);
  const maxChars = Math.max(1, Number(options.maxChars) || MAX_RECOVERY_CONTEXT_CHARS);
  const candidates = messages
    .filter((message) => (
      message
      && String(message.message_id || "") !== excludeMessageId
      && ["user", "assistant"].includes(String(message.role || ""))
      && !message.error_code
      && String(message.content || "").trim()
    ))
    .slice(-maxMessages);

  const selected = [];
  let usedChars = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index];
    const label = message.role === "user" ? "ユーザー" : "AI";
    const formatted = `${label}: ${String(message.content).trim()}`;
    const separatorChars = selected.length > 0 ? 2 : 0;
    const remaining = maxChars - usedChars - separatorChars;
    if (remaining <= 0) break;
    const content = formatted.length <= remaining
      ? formatted
      : `${formatted.slice(0, Math.max(0, remaining - 1))}…`;
    selected.unshift(content);
    usedChars += content.length + separatorChars;
    if (content.length < formatted.length) break;
  }
  return selected.join("\n\n");
}

function buildRecoveryPrompt(transcript, currentPrompt) {
  const history = String(transcript || "").trim();
  const current = String(currentPrompt || "").trim();
  if (!history) return current;
  return [
    "## セッション復旧コンテキスト",
    "以前のCodexセッションを再開できなかったため、Cotaskaに保存されている直近の会話を引き継ぎます。以下を過去の会話として扱い、現在の依頼に回答してください。",
    history,
    "## 現在の依頼",
    current,
  ].join("\n\n");
}

module.exports = {
  MAX_RECOVERY_MESSAGES,
  MAX_RECOVERY_CONTEXT_CHARS,
  isMissingCodexRolloutError,
  buildRecoveryTranscript,
  buildRecoveryPrompt,
};
