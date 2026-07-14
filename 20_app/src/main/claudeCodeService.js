// Claude Code 連携（@anthropic-ai/claude-agent-sdk）。
// codexSdkService と同一シグネチャ・同一返却スキーマを実装する共通インターフェース。
// 認証は2系統: local（ローカルサブスク・個人利用限定） / bedrock（AWS・配布可）。
const { app } = require("electron");
const aiService = require("./aiService");
const settingsService = require("./settingsService");
const appLogger = require("./appLogger");
const aiChatReferences = require("./aiChatReferences");

const DEFAULT_CLAUDE_MODEL = "claude-opus-4";
const PERMISSION_MODES = new Set(["plan", "acceptEdits", "bypassPermissions"]);
const activeRequests = new Map();
const MAX_CACHED_RUN_EVENTS = 80;

const AUTH_STATUS_LABELS = {
  available: "利用可能",
  login_required: "ログインが必要",
  expired_possible: "期限切れの可能性",
  sdk_missing: "SDK未検出",
  bedrock_unconfigured: "Bedrock設定が未完了",
  error: "確認失敗",
};

async function loadClaudeSdk() {
  try {
    return await import("@anthropic-ai/claude-agent-sdk");
  } catch (err) {
    throw new Error(`Claude Agent SDK is not available: ${err.message || err}`);
  }
}

function getClaudeSettings() {
  const aiChat = settingsService.getSettings().settings.aiChat || {};
  const claude = aiChat.claude || {};
  return { aiChat, claude };
}

function resolveClaudeModel(value, claudeSettings) {
  return String(value || claudeSettings.model || "").trim() || DEFAULT_CLAUDE_MODEL;
}

function normalizePermissionMode(value, fallback = "acceptEdits") {
  const mode = String(value || fallback).trim();
  return PERMISSION_MODES.has(mode) ? mode : fallback;
}

// Cotaska の sandboxMode 概念を Claude の permissionMode へ変換する。
function sandboxToPermissionMode(sandboxMode) {
  switch (String(sandboxMode || "")) {
    case "read-only": return "plan";
    case "workspace-write": return "acceptEdits";
    case "danger-full-access": return "bypassPermissions";
    default: return null;
  }
}

// 配布ビルド（app.isPackaged）ではローカルサブスク認証を禁止し、bedrock に矯正する。
function resolveAuthMode(claudeSettings) {
  const configured = claudeSettings.authMode === "bedrock" ? "bedrock" : "local";
  let isPackaged = false;
  try { isPackaged = Boolean(app?.isPackaged); } catch (_e) { isPackaged = false; }
  if (isPackaged && configured === "local") return "bedrock";
  return configured;
}

// 認証モードに応じて SDK 実行用の環境変数を組み立てる。
// local: 追加注入なし（~/.claude の認証を利用）。
// bedrock: CLAUDE_CODE_USE_BEDROCK=1 + AWS_PROFILE + AWS_REGION。
function buildClaudeEnv(authMode, claudeSettings) {
  const env = { ...process.env };
  if (authMode === "bedrock") {
    const bedrock = claudeSettings.bedrock || {};
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    if (bedrock.awsProfile) env.AWS_PROFILE = String(bedrock.awsProfile);
    if (bedrock.region) env.AWS_REGION = String(bedrock.region);
  } else {
    // ローカルサブスク認証時は Bedrock 用変数を除去して確実にサブスク経路を使う。
    delete env.CLAUDE_CODE_USE_BEDROCK;
  }
  return env;
}

// bedrock 時はモデルIDを bedrock.modelId で上書きする。
function resolveEffectiveModel(authMode, claudeSettings, requestedModel) {
  if (authMode === "bedrock" && claudeSettings.bedrock?.modelId) {
    return String(claudeSettings.bedrock.modelId);
  }
  return resolveClaudeModel(requestedModel, claudeSettings);
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

function isAuthRelatedErrorMessage(message) {
  const text = String(message || "").toLowerCase();
  return /auth|login|sign in|signin|credential|token|unauthorized|forbidden|expired|api key|access denied|not authenticated|bedrock|aws|profile|region/.test(text);
}

function buildUserFacingError(message) {
  if (isAuthRelatedErrorMessage(message)) {
    return {
      error: "Claude Codeの認証が必要、または認証情報・Bedrock設定に問題がある可能性があります。設定画面で認証方式と認証状態を確認してください。",
      error_kind: "auth",
      original_error: message,
    };
  }
  return { error: message, error_kind: "general", original_error: message };
}

function summarizeUsage(usage) {
  if (!usage) return null;
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return input + output;
}

function emitRunEvent(input, payload) {
  const callback = typeof input.onEvent === "function" ? input.onEvent : null;
  const requestId = getRequestId(input);
  const eventPayload = {
    request_id: requestId,
    thread_id: payload.thread_id,
    run_id: payload.run_id,
    ...payload,
  };
  const active = requestId ? activeRequests.get(requestId) : null;
  if (active) {
    active.events = [...(active.events || []), eventPayload].slice(-MAX_CACHED_RUN_EVENTS);
    active.last_event_at = new Date().toISOString();
  }
  if (!callback) return;
  try {
    callback(eventPayload);
  } catch (_err) {
    // UI更新イベントの失敗でSDK実行本体を止めない。
  }
}

function listActiveRuns() {
  return Array.from(activeRequests.entries()).map(([requestId, active]) => ({
    request_id: requestId,
    run_id: active.run_id || null,
    thread_id: active.thread_id || null,
    started_at: active.started_at || null,
    last_event_at: active.last_event_at || null,
    event_count: Array.isArray(active.events) ? active.events.length : 0,
    canceled: Boolean(active.cancelled),
  }));
}

function listRunEvents(input = {}) {
  const requestId = input.request_id || input.requestId;
  const runId = input.run_id || input.runId;
  const threadId = input.thread_id || input.threadId;
  const active = requestId
    ? activeRequests.get(String(requestId))
    : Array.from(activeRequests.values()).find((entry) => (
      (runId && entry.run_id === runId) || (threadId && entry.thread_id === threadId)
    ));
  return active?.events || [];
}

function logDiagnostics(eventName, data = {}) {
  try {
    const settings = settingsService.getSettings().settings.aiChat || {};
    if (settings.diagnosticsEnabled !== true) return;
    appLogger.logInfo(`AI_DIAGNOSTICS ${eventName}`, {
      category: "aiChat",
      provider: "claude-agent-sdk",
      diagnostics: "AI_DIAGNOSTICS",
      ...data,
    });
  } catch (_err) {
    // ログ出力の失敗でAIチャット本体を止めない。
  }
}

function cancelRun(requestId) {
  const key = requestId ? String(requestId) : "";
  const active = key ? activeRequests.get(key) : null;
  if (!active) {
    return { ok: false, error: "中断対象のAI処理が見つかりませんでした。" };
  }
  active.cancelled = true;
  try { active.controller.abort(); } catch (_e) { /* noop */ }
  if (active.run_id) {
    try {
      aiService.updateRun(active.run_id, {
        run_status: "canceled",
        error_code: "USER_CANCELED",
        error_message: "ユーザーがAI処理を中断しました。",
      });
    } catch (_err) {
      // sendMessage 側の finally で再度状態更新されるため握りつぶす。
    }
  }
  return { ok: true, canceled: true };
}

function resolveRequiredWorkdir(value) {
  const workdir = String(value || "").trim();
  if (!workdir) {
    throw new Error("設定の作業フォルダが未設定です。設定画面で作業フォルダを選択してください。");
  }
  return workdir;
}

function sanitizeAuthStatusResult(result) {
  const status = result?.status || "error";
  return {
    ok: status === "available",
    status,
    label: AUTH_STATUS_LABELS[status] || AUTH_STATUS_LABELS.error,
    message: result?.message || "Claude Code認証状態を確認できませんでした。",
    checkedAt: new Date().toISOString(),
    needsLogin: Boolean(result?.needsLogin),
    version: result?.version || null,
    checks: result?.checks || null,
  };
}

// 認証状態確認。codex doctor 相当の専用コマンドが無いため、
// 設定チェック + 軽いテストクエリで判定する。
async function checkAuthStatus() {
  let sdk;
  try {
    sdk = await loadClaudeSdk();
  } catch (_err) {
    return sanitizeAuthStatusResult({
      status: "sdk_missing",
      message: "Claude Agent SDKを読み込めませんでした。Cotaskaの依存関係を確認してください。",
      needsLogin: false,
    });
  }

  const { aiChat, claude } = getClaudeSettings();
  const authMode = resolveAuthMode(claude);

  if (authMode === "bedrock") {
    const bedrock = claude.bedrock || {};
    const missing = [];
    if (!String(bedrock.region || "").trim()) missing.push("リージョン");
    if (!String(bedrock.modelId || "").trim()) missing.push("モデルID");
    if (!String(bedrock.awsProfile || "").trim()) missing.push("AWSプロファイル名");
    if (missing.length > 0) {
      return sanitizeAuthStatusResult({
        status: "bedrock_unconfigured",
        message: `Bedrock設定が未完了です。未設定: ${missing.join(" / ")}`,
        needsLogin: true,
      });
    }
  }

  // 軽いテストクエリで実際に到達可能か確認する。
  try {
    const env = buildClaudeEnv(authMode, claude);
    const prevEnv = applyEnv(env);
    try {
      const q = sdk.query({
        prompt: "ping",
        options: {
          cwd: process.cwd(),
          permissionMode: "plan",
          maxTurns: 1,
          model: resolveEffectiveModel(authMode, claude),
        },
      });
      let gotResult = false;
      let isError = false;
      for await (const message of q) {
        if (message.type === "result") {
          gotResult = true;
          isError = Boolean(message.is_error);
          break;
        }
      }
      if (gotResult && !isError) {
        return sanitizeAuthStatusResult({
          status: "available",
          message: authMode === "bedrock"
            ? `Claudeの認証情報が構成されています（Bedrock: ${claude.bedrock?.region || "?"}）。`
            : "Claudeの認証情報が構成されています。",
          needsLogin: false,
        });
      }
      return sanitizeAuthStatusResult({
        status: "expired_possible",
        message: "Claude Code の応答を確認できませんでした。認証状態またはBedrock設定を確認してください。",
        needsLogin: true,
      });
    } finally {
      restoreEnv(prevEnv);
    }
  } catch (err) {
    const message = err?.message || String(err);
    const status = isAuthRelatedErrorMessage(message) ? "login_required" : "error";
    return sanitizeAuthStatusResult({
      status,
      message: status === "login_required"
        ? (authMode === "bedrock"
          ? "Bedrock認証に失敗しました。AWSプロファイル・リージョン・モデルIDを確認してください。"
          : "ローカルのClaude Code認証が必要です。ターミナルで claude にログインしてから再確認してください。")
        : `Claude Code認証確認に失敗しました: ${message}`,
      needsLogin: status === "login_required",
    });
  }
}

// process.env へ一時的に環境変数を適用し、元の値を返す（restoreEnv で復元）。
function applyEnv(env) {
  const keys = ["CLAUDE_CODE_USE_BEDROCK", "AWS_PROFILE", "AWS_REGION"];
  const prev = {};
  keys.forEach((k) => { prev[k] = process.env[k]; });
  keys.forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  return prev;
}

function restoreEnv(prev) {
  Object.keys(prev).forEach((k) => {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  });
}

async function sendMessage(input = {}) {
  const startedAt = Date.now();
  await aiService.openAiService();
  const inputThreadId = input.thread_id || input.threadId;
  const currentThread = inputThreadId ? aiService.getThread(inputThreadId) : null;
  const thread = currentThread || aiService.createThread({
    thread_id: inputThreadId,
    title: input.title || "Claude chat",
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
      started_at: new Date(startedAt).toISOString(),
      last_event_at: null,
      events: [],
    });
  }

  const { aiChat: settings, claude: claudeSettings } = getClaudeSettings();
  const workdir = resolveRequiredWorkdir(input.workdir || settings.workdir);
  const authMode = resolveAuthMode(claudeSettings);
  const permissionMode = normalizePermissionMode(
    sandboxToPermissionMode(input.sandboxMode || input.sandbox_mode || input.sandbox) || claudeSettings.permissionMode,
    claudeSettings.permissionMode,
  );
  const model = resolveEffectiveModel(authMode, claudeSettings, input.model);
  const performanceMode = claudeSettings.performanceMode === "speed" ? "speed" : "standard";

  const referenceContext = aiChatReferences.buildReferenceContext(thread.thread_id, workdir, settings, {
    ...input,
    isSpeedMode: performanceMode === "speed",
  });
  const prompt = referenceContext.promptPrefix
    ? `${referenceContext.promptPrefix}\n\n## ユーザー入力\n${text}`
    : text;

  const run = aiService.createRun({
    thread_id: thread.thread_id,
    sandbox: permissionMode,
    workdir,
    model,
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

  logDiagnostics("chat request started", {
    request_id: requestId,
    thread_id: thread.thread_id,
    run_id: run.run_id,
    auth_mode: authMode,
    permission_mode: permissionMode,
    workdir,
    model,
    prompt_chars: prompt.length,
    reference_files: referenceContext.usedCount,
  });

  const env = buildClaudeEnv(authMode, claudeSettings);
  const prevEnv = applyEnv(env);
  try {
    const sdk = await loadClaudeSdk();
    const sdkLoadedAt = Date.now();
    const q = sdk.query({
      prompt,
      options: {
        cwd: workdir,
        permissionMode,
        model,
        maxTurns: Number(input.maxTurns || 20),
        abortController,
      },
    });

    const items = [];
    let finalResponse = "";
    let usage = null;
    let gotResult = false;
    let resultIsError = false;
    let resultErrorMessage = "";
    let firstEventAt = null;
    let modelFromInit = null;

    for await (const message of q) {
      if (!firstEventAt) firstEventAt = Date.now();
      emitRunEvent(input, {
        type: "event",
        thread_id: thread.thread_id,
        run_id: run.run_id,
        event: message,
      });
      if (message.type === "system" && message.subtype === "init") {
        modelFromInit = message.model || null;
      } else if (message.type === "assistant") {
        const textPart = (message.message?.content || [])
          .filter((b) => b && b.type === "text")
          .map((b) => b.text)
          .join("");
        if (textPart) finalResponse = textPart;
        items.push(message);
      } else if (message.type === "result") {
        gotResult = true;
        resultIsError = Boolean(message.is_error);
        resultErrorMessage = message.is_error ? String(message.subtype || message.result || "Claude result error") : "";
        usage = message.usage || null;
        if (!finalResponse && typeof message.result === "string") finalResponse = message.result;
      }
    }

    // キャンセル判定（PoC発見）: Claude は abort 時に例外を投げず result 未受信で終了する。
    const active = requestId ? activeRequests.get(requestId) : null;
    const wasCancelled = abortController.signal.aborted || active?.cancelled || (!gotResult);
    if (wasCancelled && !gotResult) {
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
      logDiagnostics("chat canceled", { request_id: requestId, thread_id: thread.thread_id, run_id: run.run_id });
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

    if (resultIsError) {
      throw new Error(resultErrorMessage || "Claude Agent SDK returned an error result.");
    }

    aiService.updateRun(run.run_id, { run_status: "completed" });
    const assistantMessage = aiService.addMessage({
      thread_id: thread.thread_id,
      role: "assistant",
      content: finalResponse || "",
      codex_run_id: run.run_id,
      token_count: summarizeUsage(usage),
    });

    const completedAt = Date.now();
    logDiagnostics("chat assistant response", {
      request_id: requestId,
      thread_id: thread.thread_id,
      run_id: run.run_id,
      auth_mode: authMode,
      model: modelFromInit || model,
      response_chars: finalResponse.length,
      usage,
      timings_ms: {
        total: completedAt - startedAt,
        sdk_loaded: sdkLoadedAt - startedAt,
        first_event: firstEventAt ? firstEventAt - startedAt : null,
      },
    });

    return {
      ok: true,
      thread: aiService.getThread(thread.thread_id),
      run: aiService.updateRun(run.run_id, { run_status: "completed" }),
      userMessage,
      assistantMessage,
      items,
      usage,
      referenceContext,
    };
  } catch (err) {
    const message = err.message || String(err);
    appLogger.logError("AI chat failed (claude)", err);
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
      error_code: "CLAUDE_SDK_ERROR",
      error_message: message,
    });
    const userFacingError = buildUserFacingError(message);
    const errorMessage = aiService.addMessage({
      thread_id: thread.thread_id,
      role: "assistant",
      content: "",
      codex_run_id: run.run_id,
      error_code: "CLAUDE_SDK_ERROR",
      error_message: userFacingError.error,
    });
    logDiagnostics("chat failed", { request_id: requestId, thread_id: thread.thread_id, run_id: run.run_id, error: message });
    return {
      ok: false,
      thread: aiService.getThread(thread.thread_id),
      run: failedRun,
      userMessage,
      assistantMessage: errorMessage,
      error: userFacingError.error,
      error_kind: userFacingError.error_kind,
    };
  } finally {
    restoreEnv(prevEnv);
    if (requestId) {
      activeRequests.delete(requestId);
    }
  }
}

module.exports = {
  checkAuthStatus,
  cancelRun,
  listActiveRuns,
  listRunEvents,
  sendMessage,
};
