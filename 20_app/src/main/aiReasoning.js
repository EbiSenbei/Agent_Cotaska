const capabilities = require("./aiReasoningCapabilities.json");

function supportedEfforts(provider, model, authMode = "local") {
  const id = String(model || "").trim();
  const supported = provider === "codex"
    ? capabilities.codexModels.includes(id || "gpt-5.6-terra")
    : (authMode !== "bedrock" && capabilities.claudeLocalAliases.includes(id || "opus"))
      || new RegExp(capabilities.claudeModelPattern).test(id);
  return supported ? capabilities.levels.map(({ value }) => value) : [];
}

function normalizeEffort(provider, model, effort, authMode) {
  return supportedEfforts(provider, model, authMode).includes(effort) ? effort : "auto";
}

// Capture before the first await. Explicit auto/empty model must not fall back to newer settings.
function resolveExecutionSettings(aiChat, input = {}, provider, forceBedrock = false) {
  const saved = aiChat[provider] || {};
  const snapshot = input.executionSettings;
  const source = snapshot || { ...saved, ...input };
  const authMode = forceBedrock || source.authMode === "bedrock" ? "bedrock" : "local";
  const bedrock = { ...(source.bedrock || {}) };
  const model = provider === "claude" && authMode === "bedrock" ? String(bedrock.modelId || "") : String(source.model || "");
  if (provider === "claude" && authMode === "bedrock" && !model.trim()) {
    throw new Error("BedrockモデルIDが未設定です。設定画面で実行モデルを指定してください。");
  }
  const reasoningEffort = normalizeEffort(provider, model, source.reasoningEffort, authMode);
  const performanceMode = source.performanceMode === "speed" ? "speed" : "standard";
  return {
    provider, model, authMode, bedrock, reasoningEffort, performanceMode,
    sdkEffort: reasoningEffort !== "auto" ? reasoningEffort
      : provider === "codex" && performanceMode === "speed" && supportedEfforts(provider, model).includes("low") ? "low" : undefined,
  };
}

function withRuntimeAuth(result, isPackaged) {
  if (!isPackaged || !result?.settings?.aiChat) return result;
  const aiChat = result.settings.aiChat;
  const claude = aiChat.claude || {};
  return { ...result, settings: { ...result.settings, aiChat: { ...aiChat, claude: {
    ...claude, authMode: "bedrock",
    reasoningEffort: normalizeEffort("claude", claude.bedrock?.modelId, claude.reasoningEffort, "bedrock"),
  } } } };
}

module.exports = { supportedEfforts, normalizeEffort, resolveExecutionSettings, withRuntimeAuth };
