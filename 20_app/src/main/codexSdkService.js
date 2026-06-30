const path = require("path");
const fs = require("fs");
const aiService = require("./aiService");
const settingsService = require("./settingsService");

const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const activeRequests = new Map();

async function loadCodexSdk() {
  try {
    return await import("@openai/codex-sdk");
  } catch (err) {
    throw new Error(`Codex SDK is not available: ${err.message || err}`);
  }
}

function normalizeSandboxMode(value, fallback = "read-only") {
  const fallbackMode = SANDBOX_MODES.has(String(fallback)) ? String(fallback) : "read-only";
  const mode = String(value || fallbackMode).trim();
  return SANDBOX_MODES.has(mode) ? mode : fallbackMode;
}

function buildThreadOptions(thread, options = {}) {
  const settings = settingsService.getSettings().settings.aiChat || {};
  const sandboxMode = normalizeSandboxMode(options.sandboxMode || options.sandbox_mode || options.sandbox, settings.sandboxMode);
  return {
    workingDirectory: String(options.workdir || settings.workdir || path.resolve(process.cwd(), "..")),
    sandboxMode,
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    model: options.model || undefined,
  };
}

function summarizeUsage(usage) {
  if (!usage) return null;
  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.cached_input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const reasoning = Number(usage.reasoning_output_tokens || 0);
  return input + cached + output + reasoning;
}

function ensurePathInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, targetPath || "");
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function resolveReferenceFilePath(workdir, referencePath) {
  if (!referencePath) return null;
  if (path.isAbsolute(referencePath)) return path.resolve(referencePath);
  return ensurePathInside(workdir, referencePath);
}

function formatReferencePath(workdir, filePath) {
  const relative = path.relative(path.resolve(workdir), filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return filePath;
}

function buildReferenceContext(threadId, workdir, settings) {
  const maxFiles = Number(settings.maxReferenceFiles || 10);
  const maxChars = Number(settings.maxReferenceChars || 100000);
  const refs = aiService
    .listReferences(threadId)
    .filter((ref) => ref.ref_type === "file" && ref.file_path)
    .slice(0, Math.max(0, maxFiles));
  const chunks = [];
  let totalChars = 0;
  const skipped = [];

  refs.forEach((ref) => {
    const filePath = resolveReferenceFilePath(workdir, ref.file_path);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      skipped.push(ref.label || ref.file_path);
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const remaining = maxChars - totalChars;
    if (remaining <= 0) {
      skipped.push(ref.label || ref.file_path);
      return;
    }
    const sliced = content.slice(0, remaining);
    totalChars += sliced.length;
    chunks.push([
      `### ${ref.label || path.basename(filePath)}`,
      `path: ${formatReferencePath(workdir, filePath)}`,
      "```",
      sliced,
      "```",
    ].join("\n"));
    if (content.length > sliced.length) {
      skipped.push(`${ref.label || ref.file_path} (truncated)`);
    }
  });

  if (chunks.length === 0) {
    return { promptPrefix: "", usedCount: 0, totalChars, skipped };
  }
  const promptPrefix = [
    "以下はCotaskaで選択された参照ファイルです。回答時の根拠として使ってください。",
    ...chunks,
    skipped.length > 0 ? `参照上限により省略または切り詰めたファイル: ${skipped.join(", ")}` : "",
    "",
  ].filter(Boolean).join("\n\n");
  return { promptPrefix, usedCount: chunks.length, totalChars, skipped };
}

function getRequestId(input = {}) {
  const value = input.request_id || input.requestId || input.client_request_id || input.clientRequestId;
  return value ? String(value) : null;
}

function isAbortError(err) {
  const name = String(err?.name || "");
  const message = String(err?.message || err || "");
  return name === "AbortError" || /aborted|abort|cancel/i.test(message);
}

function truncateText(value, maxLength = 8000) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... truncated ...`;
}

function sanitizeThreadItem(item) {
  if (!item || typeof item !== "object") return item;
  if (item.type === "command_execution") {
    return {
      ...item,
      aggregated_output: truncateText(item.aggregated_output, 12000),
    };
  }
  if (item.type === "mcp_tool_call") {
    return {
      id: item.id,
      type: item.type,
      server: item.server,
      tool: item.tool,
      status: item.status,
      error: item.error,
    };
  }
  return item;
}

function sanitizeThreadEvent(event) {
  if (!event || typeof event !== "object") return event;
  if (event.item) {
    return {
      ...event,
      item: sanitizeThreadItem(event.item),
    };
  }
  return event;
}

function emitRunEvent(input, payload) {
  const callback = typeof input.onEvent === "function" ? input.onEvent : null;
  if (!callback) return;
  const requestId = getRequestId(input);
  try {
    callback({
      request_id: requestId,
      thread_id: payload.thread_id,
      run_id: payload.run_id,
      ...payload,
    });
  } catch (_err) {
    // UI更新イベントの失敗でSDK実行本体を止めない。
  }
}

function cancelRun(requestId) {
  const key = requestId ? String(requestId) : "";
  const active = key ? activeRequests.get(key) : null;
  if (!active) {
    return { ok: false, error: "中断対象のAI処理が見つかりませんでした。" };
  }
  active.cancelled = true;
  active.controller.abort();
  if (active.run_id) {
    try {
      aiService.updateRun(active.run_id, {
        run_status: "canceled",
        error_code: "USER_CANCELED",
        error_message: "ユーザーがAI処理を中断しました。",
      });
    } catch (_err) {
      // sendMessage 側の catch/finally で再度状態更新されるため、ここでは握りつぶす。
    }
  }
  return { ok: true, canceled: true };
}

async function sendMessage(input = {}) {
  await aiService.openAiService();
  const inputThreadId = input.thread_id || input.threadId;
  const thread = aiService.getThread(inputThreadId) || aiService.createThread({
    thread_id: inputThreadId,
    title: input.title || "Codex chat",
    primary_task_id: input.primary_task_id,
    change_id: input.change_id,
  });
  const text = String(input.content || input.message || "").trim();
  if (!text) {
    throw new Error("AI message content is required.");
  }
  const requestId = getRequestId(input);
  const abortController = new AbortController();
  if (requestId) {
    activeRequests.set(requestId, {
      controller: abortController,
      cancelled: false,
      run_id: null,
      thread_id: null,
    });
  }

  const settings = settingsService.getSettings().settings.aiChat || {};
  const workdir = String(input.workdir || settings.workdir || path.resolve(process.cwd(), ".."));
  const sandboxMode = normalizeSandboxMode(input.sandboxMode || input.sandbox_mode || input.sandbox, settings.sandboxMode);
  const referenceContext = buildReferenceContext(thread.thread_id, workdir, settings);
  const prompt = referenceContext.promptPrefix
    ? `${referenceContext.promptPrefix}\n\n## ユーザー入力\n${text}`
    : text;
  const run = aiService.createRun({
    thread_id: thread.thread_id,
    codex_thread_id: thread.codex_thread_id,
    sandbox: sandboxMode,
    workdir,
    model: input.model,
  });
  if (requestId && activeRequests.has(requestId)) {
    activeRequests.set(requestId, {
      ...activeRequests.get(requestId),
      run_id: run.run_id,
      thread_id: thread.thread_id,
    });
  }
  const userMessage = aiService.addMessage({
    thread_id: thread.thread_id,
    role: "user",
    content: text,
    codex_run_id: run.run_id,
  });

  try {
    const { Codex } = await loadCodexSdk();
    const codex = new Codex();
    const threadOptions = buildThreadOptions(thread, { ...input, workdir });
    const codexThread = thread.codex_thread_id
      ? codex.resumeThread(thread.codex_thread_id, threadOptions)
      : codex.startThread(threadOptions);
    const streamed = await codexThread.runStreamed(prompt, { signal: abortController.signal });
    const items = [];
    let finalResponse = "";
    let usage = null;
    let turnFailure = null;

    for await (const rawEvent of streamed.events) {
      const event = sanitizeThreadEvent(rawEvent);
      emitRunEvent(input, {
        type: "event",
        thread_id: thread.thread_id,
        run_id: run.run_id,
        event,
      });
      if (event.type === "item.completed") {
        if (event.item?.type === "agent_message") {
          finalResponse = event.item.text || "";
        }
        items.push(event.item);
      } else if (event.type === "turn.completed") {
        usage = event.usage || null;
      } else if (event.type === "turn.failed") {
        turnFailure = event.error;
        break;
      } else if (event.type === "error") {
        turnFailure = { message: event.message || "Codex SDK stream failed." };
        break;
      }
    }

    if (turnFailure) {
      throw new Error(turnFailure.message || "Codex SDK stream failed.");
    }
    const codexThreadId = codexThread.id || thread.codex_thread_id || null;

    if (codexThreadId && codexThreadId !== thread.codex_thread_id) {
      aiService.updateThread(thread.thread_id, { codex_thread_id: codexThreadId });
    }
    aiService.updateRun(run.run_id, {
      run_status: "completed",
      codex_thread_id: codexThreadId,
    });
    const assistantMessage = aiService.addMessage({
      thread_id: thread.thread_id,
      role: "assistant",
      content: finalResponse || "",
      codex_run_id: run.run_id,
      token_count: summarizeUsage(usage),
    });

    return {
      ok: true,
      thread: aiService.getThread(thread.thread_id),
      run: aiService.updateRun(run.run_id, { run_status: "completed", codex_thread_id: codexThreadId }),
      userMessage,
      assistantMessage,
      items,
      usage,
      referenceContext,
    };
  } catch (err) {
    const message = err.message || String(err);
    const active = requestId ? activeRequests.get(requestId) : null;
    if (abortController.signal.aborted || active?.cancelled || isAbortError(err)) {
      const canceledRun = aiService.updateRun(run.run_id, {
        run_status: "canceled",
        error_code: "USER_CANCELED",
        error_message: "ユーザーがAI処理を中断しました。",
      });
      const canceledMessage = aiService.addMessage({
        thread_id: thread.thread_id,
        role: "assistant",
        content: "AI処理を中断しました。",
        codex_run_id: run.run_id,
      });
      return {
        ok: false,
        canceled: true,
        thread: aiService.getThread(thread.thread_id),
        run: canceledRun,
        userMessage,
        assistantMessage: canceledMessage,
        error: "AI処理を中断しました。",
      };
    }
    const failedRun = aiService.updateRun(run.run_id, {
      run_status: "failed",
      error_code: "CODEX_SDK_ERROR",
      error_message: message,
    });
    const errorMessage = aiService.addMessage({
      thread_id: thread.thread_id,
      role: "assistant",
      content: "",
      codex_run_id: run.run_id,
      error_code: "CODEX_SDK_ERROR",
      error_message: message,
    });
    return {
      ok: false,
      thread: aiService.getThread(thread.thread_id),
      run: failedRun,
      userMessage,
      assistantMessage: errorMessage,
      error: message,
    };
  } finally {
    if (requestId) {
      activeRequests.delete(requestId);
    }
  }
}

module.exports = {
  cancelRun,
  sendMessage,
};
