import capabilities from "../../main/aiReasoningCapabilities.json";

export const REASONING_LEVELS = capabilities.levels;
export function getReasoningLevels(provider, model, authMode = "local") {
  const id = String(model || "").trim();
  const supported = provider === "codex"
    ? capabilities.codexModels.includes(id || "gpt-5.6-terra")
    : (authMode !== "bedrock" && capabilities.claudeLocalAliases.includes(id || "opus"))
      || new RegExp(capabilities.claudeModelPattern).test(id);
  return supported ? REASONING_LEVELS : [];
}
export function normalizeReasoning(provider, model, value, authMode) {
  return getReasoningLevels(provider, model, authMode).some((level) => level.value === value) ? value : "auto";
}
export function captureExecutionSettings(aiChat) {
  const provider = aiChat.provider === "claude" ? "claude" : "codex";
  const saved = aiChat[provider] || {};
  const authMode = saved.authMode === "bedrock" ? "bedrock" : "local";
  const model = provider === "claude" && authMode === "bedrock" ? saved.bedrock?.modelId || "" : saved.model || "";
  return {
    provider, model, authMode, bedrock: { ...(saved.bedrock || {}) },
    reasoningEffort: normalizeReasoning(provider, model, saved.reasoningEffort, authMode),
    performanceMode: saved.performanceMode === "speed" ? "speed" : "standard",
  };
}
