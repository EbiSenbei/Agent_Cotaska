const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const aiService = require("./aiService");
const settingsService = require("./settingsService");
const appLogger = require("./appLogger");

const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const PERFORMANCE_MODES = new Set(["standard", "speed"]);
const REFERENCE_SEND_MODES = new Set(["always", "manual", "skip-in-speed"]);
const activeRequests = new Map();
const codexClientCache = new Map();
const MAX_CACHED_RUN_EVENTS = 80;
const SPEED_PROFILE = {
  webSearchMode: "disabled",
  multiAgentEnabled: false,
  modelReasoningEffort: "low",
};
const AUTH_STATUS_LABELS = {
  available: "利用可能",
  login_required: "ログインが必要",
  expired_possible: "期限切れの可能性",
  sdk_missing: "SDK未検出",
  cli_unavailable: "Codex CLIを実行できません",
  error: "確認失敗",
};

async function loadCodexSdk() {
  try {
    return await import("@openai/codex-sdk");
  } catch (err) {
    throw new Error(`Codex SDK is not available: ${err.message || err}`);
  }
}

function resolveExecutablePath(filePath) {
  const unpackedPath = filePath.replace(/([\\/])app\.asar([\\/])/i, "$1app.asar.unpacked$2");
  if (unpackedPath !== filePath && fs.existsSync(unpackedPath)) return unpackedPath;
  if (unpackedPath !== filePath) return unpackedPath;
  if (fs.existsSync(filePath)) return filePath;
  return filePath;
}

function resolveBundledCodexBinary() {
  const platformPackage = process.platform === "win32"
    ? (process.arch === "arm64" ? "@openai/codex-win32-arm64" : "@openai/codex-win32-x64")
    : process.platform === "darwin"
      ? (process.arch === "arm64" ? "@openai/codex-darwin-arm64" : "@openai/codex-darwin-x64")
      : (process.arch === "arm64" ? "@openai/codex-linux-arm64" : "@openai/codex-linux-x64");
  const targetTriple = process.platform === "win32"
    ? (process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc")
    : process.platform === "darwin"
      ? (process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin")
      : (process.arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl");

  const packageJsonPath = resolveExecutablePath(require.resolve(`${platformPackage}/package.json`));
  const packageRoot = path.dirname(packageJsonPath);
  const commandCandidates = [
    path.join(
      packageRoot,
      "vendor",
      targetTriple,
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    ),
  ];

  if (process.resourcesPath) {
    commandCandidates.push(path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      ...platformPackage.split("/"),
      "vendor",
      targetTriple,
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    ));
  }

  const command = commandCandidates
    .map(resolveExecutablePath)
    .find((candidate) => fs.existsSync(candidate));

  if (!command) {
    throw new Error(`Bundled Codex CLI binary was not found. candidates=${commandCandidates.join("; ")}`);
  }

  const pathDirs = [
    path.join(
      packageRoot,
      "vendor",
      targetTriple,
      "codex-path",
    ),
    path.join(
      packageRoot,
      "vendor",
      targetTriple,
      "path",
    ),
  ].map(resolveExecutablePath).filter((candidate) => fs.existsSync(candidate));

  return { command, argsPrefix: [], pathDirs };
}

function buildCodexEnv(binary) {
  if (!binary?.pathDirs?.length) return undefined;
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = [
    ...binary.pathDirs,
    env[pathKey] || "",
  ].filter(Boolean).join(path.delimiter);
  return env;
}

function getCodexBinaryDiagnostics(binary) {
  if (!binary) return null;
  return {
    command: binary.command,
    exists: fs.existsSync(binary.command),
    pathDirs: binary.pathDirs || [],
  };
}

function createCodexPathError(binary) {
  const err = new Error(`Codex CLI binary is not executable: ${binary?.command || "(missing)"}`);
  err.code = "CODEX_CLI_MISSING";
  return err;
}

function assertCodexBinaryUsable(binary) {
  if (!binary?.command || !fs.existsSync(binary.command)) {
    throw createCodexPathError(binary);
  }
}

function buildCodexClientOptions(settings, options = {}) {
  const codexOptions = buildCodexOptions(settings, options);
  try {
    const binary = resolveBundledCodexBinary();
    assertCodexBinaryUsable(binary);
    appLogger.logInfo("Codex CLI path resolved", {
      category: "aiChat",
      ...getCodexBinaryDiagnostics(binary),
    });
    return {
      ...codexOptions,
      codexPathOverride: binary.command,
      env: buildCodexEnv(binary),
    };
  } catch (err) {
    appLogger.logError("Codex CLI path could not be resolved", err);
    appLogger.logWarning("Codex SDK default CLI resolution was skipped to avoid app.asar executable paths", {
      category: "aiChat",
      error: err.message || String(err),
    });
    throw err;
  }
}

async function getCodexClient(settings, options = {}) {
  const { Codex } = await loadCodexSdk();
  const codexOptions = buildCodexClientOptions(settings, options);
  const cacheKey = JSON.stringify(codexOptions);
  const cached = codexClientCache.get(cacheKey);
  if (cached) {
    return { codex: cached, reused: true };
  }

  const codex = new Codex(codexOptions);
  codexClientCache.set(cacheKey, codex);
  return { codex, reused: false };
}

function runCodexCli(args, options = {}) {
  return new Promise((resolve) => {
    let binary;
    try {
      binary = resolveBundledCodexBinary();
      assertCodexBinaryUsable(binary);
    } catch (err) {
      resolve({ ok: false, missing: true, error: err.message || String(err) });
      return;
    }

    execFile(binary.command, [...binary.argsPrefix, ...args], {
      cwd: options.cwd || process.cwd(),
      env: buildCodexEnv(binary) || process.env,
      timeout: Number(options.timeoutMs || 25000),
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: typeof error?.code === "number" ? error.code : 0,
        signal: error?.signal || null,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: error?.message || "",
      });
    });
  });
}

function safeDoctorCheck(checks, id) {
  const check = checks?.[id] || null;
  if (!check) return null;
  return {
    status: String(check.status || "unknown"),
    summary: String(check.summary || ""),
    category: String(check.category || ""),
  };
}

function classifyDoctorResult(doctor) {
  const checks = doctor?.checks || {};
  const auth = safeDoctorCheck(checks, "auth.credentials");
  const providerReachability = safeDoctorCheck(checks, "network.provider_reachability");
  const websocketReachability = safeDoctorCheck(checks, "network.websocket_reachability");
  const installation = safeDoctorCheck(checks, "installation");
  const authSummary = `${auth?.summary || ""}`.toLowerCase();
  const authStatus = auth?.status || "unknown";

  if (!auth) {
    return {
      status: "error",
      message: "Codex診断結果から認証状態を判定できませんでした。",
      needsLogin: false,
    };
  }
  if (authStatus === "ok") {
    return {
      status: "available",
      message: "Codexの認証情報が構成されています。",
      needsLogin: false,
    };
  }
  if (/not configured|missing|no auth|login|required|sign in/.test(authSummary)) {
    return {
      status: "login_required",
      message: "Codexのログインが必要です。",
      needsLogin: true,
    };
  }
  return {
    status: "expired_possible",
    message: "Codex認証情報が無効、期限切れ、または権限不足の可能性があります。",
    needsLogin: true,
    checks: {
      auth,
      providerReachability,
      websocketReachability,
      installation,
    },
  };
}

function sanitizeAuthStatusResult(result) {
  const status = result?.status || "error";
  return {
    ok: status === "available",
    status,
    label: AUTH_STATUS_LABELS[status] || AUTH_STATUS_LABELS.error,
    message: result?.message || "Codex認証状態を確認できませんでした。",
    checkedAt: new Date().toISOString(),
    needsLogin: Boolean(result?.needsLogin),
    version: result?.version || null,
    checks: result?.checks || null,
  };
}

async function checkAuthStatus() {
  try {
    await loadCodexSdk();
  } catch (err) {
    return sanitizeAuthStatusResult({
      status: "sdk_missing",
      message: "Codex SDKを読み込めませんでした。Cotaskaの依存関係を確認してください。",
      needsLogin: false,
    });
  }

  const versionResult = await runCodexCli(["--version"], { timeoutMs: 10000 });
  if (versionResult.missing) {
    return sanitizeAuthStatusResult({
      status: "sdk_missing",
      message: "Codex SDK同梱のCodex CLIが見つかりませんでした。",
      needsLogin: false,
    });
  }
  if (!versionResult.ok) {
    return sanitizeAuthStatusResult({
      status: "cli_unavailable",
      message: "Codex CLIを実行できませんでした。インストール状態または実行権限を確認してください。",
      needsLogin: false,
    });
  }

  const doctorResult = await runCodexCli(["doctor", "--json"], { timeoutMs: 30000 });
  if (!doctorResult.ok && !doctorResult.stdout.trim()) {
    const combined = `${doctorResult.stderr}\n${doctorResult.error}`.toLowerCase();
    const status = /login|auth|credential|token|unauthorized|forbidden|expired/.test(combined)
      ? "expired_possible"
      : "error";
    return sanitizeAuthStatusResult({
      status,
      message: status === "expired_possible"
        ? "Codex認証情報が無効、期限切れ、または権限不足の可能性があります。"
        : "Codex診断の実行に失敗しました。",
      needsLogin: status === "expired_possible",
      version: versionResult.stdout.trim() || null,
    });
  }

  try {
    const doctor = JSON.parse(doctorResult.stdout);
    const classified = classifyDoctorResult(doctor);
    return sanitizeAuthStatusResult({
      ...classified,
      version: doctor.codexVersion || versionResult.stdout.trim() || null,
    });
  } catch (_err) {
    return sanitizeAuthStatusResult({
      status: "error",
      message: "Codex診断結果を読み取れませんでした。",
      needsLogin: false,
      version: versionResult.stdout.trim() || null,
    });
  }
}

function normalizeSandboxMode(value, fallback = "read-only") {
  const fallbackMode = SANDBOX_MODES.has(String(fallback)) ? String(fallback) : "read-only";
  const mode = String(value || fallbackMode).trim();
  return SANDBOX_MODES.has(mode) ? mode : fallbackMode;
}

function normalizePerformanceMode(value, fallback = "standard") {
  const fallbackMode = PERFORMANCE_MODES.has(String(fallback)) ? String(fallback) : "standard";
  const mode = String(value || fallbackMode).trim();
  return PERFORMANCE_MODES.has(mode) ? mode : fallbackMode;
}

function normalizeReferenceSendMode(value, fallback = "always") {
  const fallbackMode = REFERENCE_SEND_MODES.has(String(fallback)) ? String(fallback) : "always";
  const mode = String(value || fallbackMode).trim();
  return REFERENCE_SEND_MODES.has(mode) ? mode : fallbackMode;
}

function buildCodexOptions(settings, options = {}) {
  const performanceMode = normalizePerformanceMode(
    options.performanceMode || options.performance_mode,
    settings.performanceMode,
  );
  if (performanceMode !== "speed") return {};
  return {
    config: {
      service_tier: "fast",
      web_search: SPEED_PROFILE.webSearchMode,
      features: {
        fast_mode: true,
        multi_agent: SPEED_PROFILE.multiAgentEnabled,
      },
    },
  };
}

function buildThreadOptions(thread, options = {}) {
  const settings = settingsService.getSettings().settings.aiChat || {};
  const sandboxMode = normalizeSandboxMode(options.sandboxMode || options.sandbox_mode || options.sandbox, settings.sandboxMode);
  const performanceMode = normalizePerformanceMode(options.performanceMode || options.performance_mode, settings.performanceMode);
  return {
    workingDirectory: resolveRequiredWorkdir(options.workdir || settings.workdir),
    sandboxMode,
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    model: options.model || undefined,
    modelReasoningEffort: performanceMode === "speed" ? SPEED_PROFILE.modelReasoningEffort : undefined,
  };
}

function resolveRequiredWorkdir(value) {
  const workdir = String(value || "").trim();
  if (!workdir) {
    throw new Error("設定の作業フォルダが未設定です。設定画面で作業フォルダを選択してください。");
  }
  return workdir;
}

function buildPerformanceDiagnostics(performanceMode) {
  const isSpeed = performanceMode === "speed";
  return {
    performance_mode: performanceMode,
    fast_mode_requested: isSpeed,
    web_search_mode: isSpeed ? SPEED_PROFILE.webSearchMode : null,
    multi_agent_enabled: isSpeed ? SPEED_PROFILE.multiAgentEnabled : null,
    model_reasoning_effort: isSpeed ? SPEED_PROFILE.modelReasoningEffort : null,
  };
}

function summarizeUsage(usage) {
  if (!usage) return null;
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const reasoning = Number(usage.reasoning_output_tokens || 0);
  return input + output + reasoning;
}

function shouldUsePersistentCodexThread(performanceMode) {
  return performanceMode !== "speed";
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

function buildReferenceContext(threadId, workdir, settings, options = {}) {
  const performanceMode = normalizePerformanceMode(options.performanceMode || options.performance_mode, settings.performanceMode);
  const configuredMode = normalizeReferenceSendMode(settings.referenceSendMode);
  const requestedMode = options.referenceSendMode || options.reference_send_mode;
  const referenceSendMode = requestedMode === "force"
    ? "always"
    : requestedMode === "skip"
      ? "manual"
      : normalizeReferenceSendMode(requestedMode, configuredMode);
  const shouldSendReferences = referenceSendMode === "always"
    || (referenceSendMode === "skip-in-speed" && performanceMode !== "speed");
  if (!shouldSendReferences) {
    return {
      promptPrefix: "",
      usedCount: 0,
      totalChars: 0,
      skipped: [],
      sendMode: referenceSendMode,
      sent: false,
      skippedReason: referenceSendMode === "manual" ? "manual" : "speed",
    };
  }
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
    return { promptPrefix: "", usedCount: 0, totalChars, skipped, sendMode: referenceSendMode, sent: false, skippedReason: "empty" };
  }
  const promptPrefix = [
    "以下はCotaskaで選択された参照ファイルです。回答時の根拠として使ってください。",
    ...chunks,
    skipped.length > 0 ? `参照上限により省略または切り詰めたファイル: ${skipped.join(", ")}` : "",
    "",
  ].filter(Boolean).join("\n\n");
  return { promptPrefix, usedCount: chunks.length, totalChars, skipped, sendMode: referenceSendMode, sent: true, skippedReason: null };
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
  return /auth|login|sign in|signin|credential|token|unauthorized|forbidden|expired|api key|access denied|not authenticated/.test(text);
}

function buildUserFacingError(message) {
  if (isAuthRelatedErrorMessage(message)) {
    return {
      error: "Codexの認証が必要、または認証情報が期限切れの可能性があります。設定画面でCodex認証状態を確認してください。",
      error_kind: "auth",
      original_error: message,
    };
  }
  return {
    error: message,
    error_kind: "general",
    original_error: message,
  };
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

// CHG-058 AI_DIAGNOSTICS:
// AI応答速度調査用ログ。調査完了後に削除または設定化する。
function logAiChatDiagnostics(eventName, data = {}) {
  try {
    const settings = settingsService.getSettings().settings.aiChat || {};
    if (settings.diagnosticsEnabled !== true) return;
    appLogger.logInfo(`AI_DIAGNOSTICS ${eventName}`, {
      category: "aiChat",
      provider: "codex-sdk",
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
  const startedAt = Date.now();
  await aiService.openAiService();
  const inputThreadId = input.thread_id || input.threadId;
  const currentThread = inputThreadId ? aiService.getThread(inputThreadId) : null;
  const thread = currentThread || aiService.createThread({
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
      started_at: new Date(startedAt).toISOString(),
      last_event_at: null,
      events: [],
    });
  }

  const settings = settingsService.getSettings().settings.aiChat || {};
  const workdir = resolveRequiredWorkdir(input.workdir || settings.workdir);
  const sandboxMode = normalizeSandboxMode(input.sandboxMode || input.sandbox_mode || input.sandbox, settings.sandboxMode);
  const performanceMode = normalizePerformanceMode(input.performanceMode || input.performance_mode, settings.performanceMode);
  const usePersistentCodexThread = shouldUsePersistentCodexThread(performanceMode);
  const codexThreadIdForRun = usePersistentCodexThread ? thread.codex_thread_id : null;
  const codexThreadStrategy = usePersistentCodexThread ? "persistent" : "transient";
  const referenceContext = buildReferenceContext(thread.thread_id, workdir, settings, {
    ...input,
    performanceMode,
  });
  const prompt = referenceContext.promptPrefix
    ? `${referenceContext.promptPrefix}\n\n## ユーザー入力\n${text}`
    : text;
  const run = aiService.createRun({
    thread_id: thread.thread_id,
    codex_thread_id: codexThreadIdForRun,
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

  logAiChatDiagnostics("chat request started", {
    request_id: requestId,
    thread_id: thread.thread_id,
    run_id: run.run_id,
    codex_thread_id: codexThreadIdForRun,
    stored_codex_thread_id: thread.codex_thread_id,
    codex_thread_strategy: codexThreadStrategy,
    codex_thread_reused: Boolean(codexThreadIdForRun),
    sandbox: sandboxMode,
    ...buildPerformanceDiagnostics(performanceMode),
    workdir,
    model: input.model || null,
    prompt_chars: prompt.length,
    user_input_chars: text.length,
    reference_files: referenceContext.usedCount,
    reference_chars: referenceContext.totalChars,
    reference_skipped: referenceContext.skipped,
    reference_send_mode: referenceContext.sendMode,
    reference_sent: referenceContext.sent,
    reference_skipped_reason: referenceContext.skippedReason,
  });

  try {
    const { codex, reused: codexClientReused } = await getCodexClient(settings, { ...input, performanceMode });
    const sdkLoadedAt = Date.now();
    const threadOptions = buildThreadOptions(thread, { ...input, workdir, performanceMode });
    const codexThread = codexThreadIdForRun
      ? codex.resumeThread(codexThreadIdForRun, threadOptions)
      : codex.startThread(threadOptions);
    const streamed = await codexThread.runStreamed(prompt, { signal: abortController.signal });
    const streamStartedAt = Date.now();
    const items = [];
    let finalResponse = "";
    let usage = null;
    let turnFailure = null;
    let firstEventAt = null;
    let firstAgentMessageAt = null;

    for await (const rawEvent of streamed.events) {
      if (!firstEventAt) firstEventAt = Date.now();
      const event = sanitizeThreadEvent(rawEvent);
      emitRunEvent(input, {
        type: "event",
        thread_id: thread.thread_id,
        run_id: run.run_id,
        event,
      });
      if (event.type === "item.completed") {
        if (event.item?.type === "agent_message") {
          if (!firstAgentMessageAt) firstAgentMessageAt = Date.now();
          finalResponse = event.item.text || "";
        }
        items.push(event.item);
      } else if (event.type === "item.updated" && event.item?.type === "agent_message") {
        if (!firstAgentMessageAt) firstAgentMessageAt = Date.now();
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
    const codexThreadId = codexThread.id || codexThreadIdForRun || null;
    const persistCodexThreadId = usePersistentCodexThread && codexThreadId;

    if (persistCodexThreadId && codexThreadId !== thread.codex_thread_id) {
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

    const completedAt = Date.now();
    logAiChatDiagnostics("chat assistant response", {
      request_id: requestId,
      thread_id: thread.thread_id,
      run_id: run.run_id,
      codex_thread_id: codexThreadId,
      stored_codex_thread_id: thread.codex_thread_id,
      codex_thread_strategy: codexThreadStrategy,
      codex_thread_reused: Boolean(codexThreadIdForRun),
      codex_thread_persisted: Boolean(persistCodexThreadId),
      codex_client_reused: codexClientReused,
      message_id: assistantMessage.message_id,
      response_chars: finalResponse.length,
      ...buildPerformanceDiagnostics(performanceMode),
      usage,
      timings_ms: {
        total: completedAt - startedAt,
        open_ai_service_to_sdk_loaded: sdkLoadedAt - startedAt,
        sdk_loaded_to_stream_started: streamStartedAt - sdkLoadedAt,
        stream_started_to_first_event: firstEventAt ? firstEventAt - streamStartedAt : null,
        stream_started_to_first_agent_message: firstAgentMessageAt ? firstAgentMessageAt - streamStartedAt : null,
        stream_started_to_completed: completedAt - streamStartedAt,
      },
      reference_context: {
        used_count: referenceContext.usedCount,
        total_chars: referenceContext.totalChars,
        skipped: referenceContext.skipped,
        send_mode: referenceContext.sendMode,
        sent: referenceContext.sent,
        skipped_reason: referenceContext.skippedReason,
      },
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
    appLogger.logError("AI chat failed", err);
    appLogger.logInfo("AI chat failure context", {
      category: "aiChat",
      request_id: requestId,
      thread_id: thread.thread_id,
      run_id: run.run_id,
      elapsed_ms: Date.now() - startedAt,
      error: message,
    });
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
      logAiChatDiagnostics("chat canceled", {
        request_id: requestId,
        thread_id: thread.thread_id,
        run_id: run.run_id,
        elapsed_ms: Date.now() - startedAt,
        response_chars: canceledMessage.content.length,
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
    const userFacingError = buildUserFacingError(message);
    const errorMessage = aiService.addMessage({
      thread_id: thread.thread_id,
      role: "assistant",
      content: "",
      codex_run_id: run.run_id,
      error_code: "CODEX_SDK_ERROR",
      error_message: userFacingError.error,
    });
    logAiChatDiagnostics("chat failed", {
      request_id: requestId,
      thread_id: thread.thread_id,
      run_id: run.run_id,
      elapsed_ms: Date.now() - startedAt,
      error: message,
    });
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
