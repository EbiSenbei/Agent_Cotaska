function assertThreadArchivable(threadId, registry, pendingSends = new Set()) {
  const isRunning = pendingSends.has(threadId) || ["codex", "claude"].some((provider) => (
    registry.resolveProvider(provider).listActiveRuns().some((run) => run.thread_id === threadId)
  ));
  if (isRunning) throw new Error("AI処理中・送信準備中のスレッドはアーカイブできません。");
}

module.exports = { assertThreadArchivable };
