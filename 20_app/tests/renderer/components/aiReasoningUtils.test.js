import { captureExecutionSettings, getReasoningLevels } from "../../../src/renderer/components/aiReasoningUtils";
const { supportedEfforts } = require("../../../src/main/aiReasoning");

test("UI and Main capability policies agree", () => {
  for (const provider of ["codex", "claude"]) for (const auth of ["local", "bedrock"]) {
    for (const model of ["", "opus", "sonnet", "gpt-6.1-sol", "custom", "us.anthropic.claude-opus-4-6-v1", "anthropic.claude-sonnet-4-5-v1"]) {
      expect(getReasoningLevels(provider, model, auth).map((level) => level.value)).toEqual(supportedEfforts(provider, model, auth));
    }
  }
});
test("enqueue snapshot copies connection settings and resolves unsupported effort", () => {
  const aiChat = { provider: "claude", claude: { authMode: "bedrock", reasoningEffort: "high", bedrock: { modelId: "custom", awsProfile: "original" } } };
  const snapshot = captureExecutionSettings(aiChat);
  aiChat.claude.bedrock.awsProfile = "changed";
  expect(snapshot).toMatchObject({ provider: "claude", model: "custom", reasoningEffort: "auto", bedrock: { awsProfile: "original" } });
});
