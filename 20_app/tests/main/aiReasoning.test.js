const { supportedEfforts, normalizeEffort, resolveExecutionSettings, withRuntimeAuth } = require("../../src/main/aiReasoning");

describe("CHG-154 reasoning execution policy", () => {
  test("packaged UI uses effective Bedrock model support without mutating stored settings", () => {
    const saved = { settings: { aiChat: { claude: { authMode: "local", model: "opus", reasoningEffort: "high", bedrock: { modelId: "unknown" } } } } };
    expect(withRuntimeAuth(saved, false)).toBe(saved);
    expect(withRuntimeAuth(saved, true).settings.aiChat.claude).toMatchObject({ authMode: "bedrock", reasoningEffort: "auto" });
    expect(saved.settings.aiChat.claude.authMode).toBe("local");
  });
  test("known models only, Bedrock uses actual ID rather than aliases", () => {
    expect(supportedEfforts("codex", "gpt-6.1-sol")).toEqual(["low", "medium", "high"]);
    expect(supportedEfforts("codex", "custom-model")).toEqual([]);
    expect(supportedEfforts("claude", "opus", "local")).toHaveLength(3);
    expect(supportedEfforts("claude", "opus", "bedrock")).toEqual([]);
    expect(supportedEfforts("claude", "us.anthropic.claude-sonnet-4-6", "bedrock")).toHaveLength(3);
    expect(supportedEfforts("claude", "anthropic.claude-sonnet-4-5-20250929-v1:0", "bedrock")).toEqual([]);
    expect(normalizeEffort("codex", "custom-model", "high")).toBe("auto");
    expect(normalizeEffort("codex", "gpt-6.1-sol", "max")).toBe("auto");
  });
  test.each(["standard", "speed"])("explicit effort wins in %s mode", (performanceMode) => {
    for (const provider of ["codex", "claude"]) {
      for (const reasoningEffort of ["low", "medium", "high"]) {
        const aiChat = { [provider]: { model: provider === "codex" ? "gpt-6.1-sol" : "opus", performanceMode, reasoningEffort } };
        expect(resolveExecutionSettings(aiChat, {}, provider).sdkEffort).toBe(reasoningEffort);
      }
    }
  });
  test("auto preserves speed behavior and omits effort otherwise", () => {
    expect(resolveExecutionSettings({ codex: { performanceMode: "speed" } }, {}, "codex").sdkEffort).toBe("low");
    expect(resolveExecutionSettings({}, {}, "codex").sdkEffort).toBeUndefined();
    expect(resolveExecutionSettings({ claude: { performanceMode: "speed" } }, {}, "claude").sdkEffort).toBeUndefined();
    expect(resolveExecutionSettings({ codex: { model: "unknown", performanceMode: "speed" } }, {}, "codex").sdkEffort).toBeUndefined();
  });
  test("queued auto/empty model and Bedrock settings never use newer preferences", () => {
    const executionSettings = { provider: "codex", model: "", reasoningEffort: "auto", performanceMode: "standard" };
    expect(resolveExecutionSettings({ codex: { model: "gpt-6-astra", reasoningEffort: "high", performanceMode: "speed" } }, { executionSettings }, "codex"))
      .toMatchObject({ model: "", reasoningEffort: "auto", performanceMode: "standard", sdkEffort: undefined });
    const bedrock = { authMode: "bedrock", bedrock: { modelId: "anthropic.claude-opus-4-6-v1", awsProfile: "original" }, reasoningEffort: "high" };
    const resolved = resolveExecutionSettings({ claude: { authMode: "local", model: "sonnet" } }, { executionSettings: bedrock }, "claude");
    bedrock.bedrock.awsProfile = "changed";
    expect(resolved).toMatchObject({ model: "anthropic.claude-opus-4-6-v1", sdkEffort: "high", bedrock: { awsProfile: "original" } });
  });
});
