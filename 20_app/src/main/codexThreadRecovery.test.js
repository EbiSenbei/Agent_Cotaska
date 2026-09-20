const {
  MAX_RECOVERY_MESSAGES,
  MAX_RECOVERY_CONTEXT_CHARS,
  isMissingCodexRolloutError,
  buildRecoveryTranscript,
  buildRecoveryPrompt,
} = require("./codexThreadRecovery");

describe("codexThreadRecovery", () => {
  test("rollout欠損のresumeエラーだけを復旧対象にする", () => {
    expect(isMissingCodexRolloutError(new Error(
      "thread/resume: thread/resume failed: no rollout found for thread id abc",
    ))).toBe(true);
    expect(isMissingCodexRolloutError(new Error("no rollout found for thread id abc"))).toBe(false);
    expect(isMissingCodexRolloutError(new Error("thread/resume failed: authentication required"))).toBe(false);
  });

  test("正常な直近会話だけを上限付きで復旧コンテキストにする", () => {
    const messages = Array.from({ length: MAX_RECOVERY_MESSAGES + 3 }, (_, index) => ({
      message_id: `m-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}`,
    }));
    messages.push({ message_id: "failed", role: "assistant", content: "失敗", error_code: "ERR" });
    messages.push({ message_id: "current", role: "user", content: "今回", error_code: null });

    const transcript = buildRecoveryTranscript(messages, { excludeMessageId: "current" });

    expect(transcript).not.toContain("message-0");
    expect(transcript).toContain("message-14");
    expect(transcript).not.toContain("失敗");
    expect(transcript).not.toContain("今回");
    expect(transcript.length).toBeLessThanOrEqual(MAX_RECOVERY_CONTEXT_CHARS);
  });

  test("文字数上限を守り、現在の依頼と区別した復旧プロンプトを作る", () => {
    const transcript = buildRecoveryTranscript([
      { message_id: "old", role: "user", content: "あ".repeat(100) },
    ], { maxChars: 30 });
    const prompt = buildRecoveryPrompt(transcript, "現在の質問");

    expect(transcript.length).toBeLessThanOrEqual(30);
    expect(prompt).toContain("セッション復旧コンテキスト");
    expect(prompt).toContain("現在の質問");
  });
});
