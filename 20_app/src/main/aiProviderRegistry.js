// AI連携先プロバイダのディスパッチャ。
// settings.aiChat.provider に応じて codexSdkService / claudeCodeService を返す。
// 両サービスは同一シグネチャ（sendMessage / checkAuthStatus / cancelRun /
// listActiveRuns / listRunEvents）を実装している。
const codexSdkService = require("./codexSdkService");
const claudeCodeService = require("./claudeCodeService");
const settingsService = require("./settingsService");

function normalizeProvider(value) {
  const provider = String(value || "codex").trim();
  return provider === "claude" ? "claude" : "codex";
}

// 現在の設定から有効なプロバイダ名を返す。
function getActiveProvider() {
  const aiChat = settingsService.getSettings().settings.aiChat || {};
  return normalizeProvider(aiChat.provider);
}

// プロバイダ名（省略時は現在設定）からサービス実装を返す。
function resolveProvider(providerName) {
  const provider = providerName ? normalizeProvider(providerName) : getActiveProvider();
  return provider === "claude" ? claudeCodeService : codexSdkService;
}

module.exports = {
  getActiveProvider,
  resolveProvider,
};
