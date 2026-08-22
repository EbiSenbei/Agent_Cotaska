const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const COTASKA_RESOURCE_ROOT_DIR = path.resolve(__dirname, "../../..");
const APP_CONFIG_FILENAME = "app-config.yaml";
const DEFAULT_APP_CONFIG = {
  update: {
    latestVersionUrl: "https://pub-d671fdad660b43a8a4b99ede58b7c092.r2.dev/latest/version.json",
    downloadPageUrl: "https://ebisenbei.github.io/cotaska-site/download.html",
  },
};

function resolveCotaskaRootDir(resourceRoot = COTASKA_RESOURCE_ROOT_DIR) {
  const normalized = path.resolve(resourceRoot);
  if (
    path.basename(normalized).toLowerCase() === "resources"
    && path.basename(path.dirname(normalized)).toLowerCase() === "_app"
  ) {
    return path.dirname(path.dirname(normalized));
  }
  return normalized;
}

const COTASKA_ROOT_DIR = resolveCotaskaRootDir();
const COTASKA_DATA_DIR = path.join(COTASKA_ROOT_DIR, "data");
const LEGACY_RESOURCE_DATA_DIR = COTASKA_RESOURCE_ROOT_DIR === COTASKA_ROOT_DIR
  ? null
  : path.join(COTASKA_RESOURCE_ROOT_DIR, "data");

const DEFAULT_SETTINGS = {
  displayName: "Cotaska",
  externalEditorPath: "",
  startup: {
    initialView: "今日",
  },
  onboarding: {
    completed: false,
  },
  notification: {
    minutesBefore: 5,
  },
  detailTextSize: 14,
  taskLoading: {
    completedInitialLimit: 100,
    completedLoadMoreLimit: 100,
  },
  logging: {
    level: "info",
  },
  aiChat: {
    // 連携先プロバイダ: codex / claude
    provider: "codex",
    // --- 共通項目（両プロバイダで共用） ---
    workdir: "",
    diagnosticsEnabled: false,
    retentionDays: 90,
    maxReferenceFiles: 10,
    maxReferenceChars: 100000,
    referenceSendMode: "always",
    // --- Codex 固有 ---
    codex: {
      model: "",
      sandboxMode: "read-only",
      performanceMode: "standard",
    },
    // --- Claude Code 固有 ---
    claude: {
      // 空欄は Claude Code 側の既定モデルを使用する（設定画面では「自動」）。
      model: "",
      performanceMode: "standard",
      // 認証方式: local（ローカルサブスク・個人利用限定） / bedrock（クラウドプロバイダ・配布可）
      authMode: "local",
      // 権限モード（sandboxMode 相当）: plan / acceptEdits / bypassPermissions
      permissionMode: "acceptEdits",
      bedrock: {
        region: "",
        modelId: "",
        // AWSプロファイル名のみ保存。実資格情報は ~/.aws に委ねる
        awsProfile: "",
      },
    },
  },
  update: {
    latestVersionUrl: "https://pub-d671fdad660b43a8a4b99ede58b7c092.r2.dev/latest/version.json",
    downloadPageUrl: "https://ebisenbei.github.io/cotaska-site/download.html",
  },
};

const LEGACY_DEFAULT_UPDATE = {
  latestVersionUrls: [
    "https://api.github.com/repos/EbiSenbei/Agent_Cotaska/releases/latest",
    "https://api.github.com/repos/csho10051/Agent_Cotaska/releases/latest",
  ],
  downloadPageUrls: [
    "https://github.com/EbiSenbei/Agent_Cotaska/releases",
    "https://github.com/csho10051/Agent_Cotaska/releases",
  ],
};

const PREVIOUS_DEFAULT_UPDATE = {
  downloadPageUrl: "https://pub-d671fdad660b43a8a4b99ede58b7c092.r2.dev/latest/Cotaska-Portable.zip",
};

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeSandboxMode(value, fallback = DEFAULT_SETTINGS.aiChat.codex.sandboxMode) {
  const mode = String(value || fallback).trim();
  return ["read-only", "workspace-write", "danger-full-access"].includes(mode) ? mode : fallback;
}

function normalizePerformanceMode(value, fallback = "standard") {
  const mode = String(value || fallback).trim();
  return ["standard", "speed"].includes(mode) ? mode : fallback;
}

function normalizeReferenceSendMode(value, fallback = DEFAULT_SETTINGS.aiChat.referenceSendMode) {
  const mode = String(value || fallback).trim();
  return ["always", "manual", "skip-in-speed"].includes(mode) ? mode : fallback;
}

function normalizeAiProvider(value, fallback = DEFAULT_SETTINGS.aiChat.provider) {
  const provider = String(value || fallback).trim();
  return ["codex", "claude"].includes(provider) ? provider : fallback;
}

function normalizeClaudeAuthMode(value, fallback = DEFAULT_SETTINGS.aiChat.claude.authMode) {
  const mode = String(value || fallback).trim();
  return ["local", "bedrock"].includes(mode) ? mode : fallback;
}

function normalizeClaudePermissionMode(value, fallback = DEFAULT_SETTINGS.aiChat.claude.permissionMode) {
  const mode = String(value || fallback).trim();
  return ["plan", "acceptEdits", "bypassPermissions"].includes(mode) ? mode : fallback;
}

function normalizeLogLevel(value, fallback = DEFAULT_SETTINGS.logging.level) {
  const level = String(value || fallback).trim().toLowerCase();
  return ["debug", "info", "warn", "error"].includes(level) ? level : fallback;
}

function normalizeStartupInitialView(value, fallback = DEFAULT_SETTINGS.startup.initialView) {
  const view = String(value || fallback).trim();
  return ["すべて", "今日", "明日", "次の7日間"].includes(view) ? view : fallback;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isAiWorkdirConfigured(raw) {
  return Boolean(String(raw?.aiChat?.workdir || "").trim());
}

function isLegacyGeneratedWorkdir(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  const resolved = path.resolve(normalized);
  const generatedResourceRoot = path.resolve(COTASKA_RESOURCE_ROOT_DIR);
  const resourceRootPattern = new RegExp(`[\\\\/]_app[\\\\/]resources$`, "i");
  return resourceRootPattern.test(generatedResourceRoot) && resolved.toLowerCase() === generatedResourceRoot.toLowerCase();
}

function normalizeAiWorkdir(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return isLegacyGeneratedWorkdir(normalized) ? "" : normalized;
}

function validateAiWorkdir(workdir) {
  const normalized = String(workdir || "").trim();
  if (!normalized) return;
  if (!path.isAbsolute(normalized)) {
    throw new Error("作業フォルダには存在するフォルダの絶対パスを指定してください。");
  }
  if (!fs.existsSync(normalized)) {
    throw new Error("作業フォルダに存在しないパスは指定できません。");
  }
  const stat = fs.statSync(normalized);
  if (!stat.isDirectory()) {
    throw new Error("作業フォルダにはファイルではなくフォルダを指定してください。");
  }
}

function getDataDir() {
  return COTASKA_DATA_DIR;
}

function copyLegacyEntryIfMissing(entryName) {
  if (!LEGACY_RESOURCE_DATA_DIR || !fs.existsSync(LEGACY_RESOURCE_DATA_DIR)) return false;
  const source = path.join(LEGACY_RESOURCE_DATA_DIR, entryName);
  const target = path.join(COTASKA_DATA_DIR, entryName);
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: false });
  return true;
}

function migrateLegacyResourceData() {
  if (!LEGACY_RESOURCE_DATA_DIR || !fs.existsSync(LEGACY_RESOURCE_DATA_DIR)) {
    return { migrated: false, entries: [] };
  }
  fs.mkdirSync(COTASKA_DATA_DIR, { recursive: true });
  const entries = fs.readdirSync(LEGACY_RESOURCE_DATA_DIR);
  const copied = entries.filter((entry) => copyLegacyEntryIfMissing(entry));
  return { migrated: copied.length > 0, entries: copied };
}

function getSettingsPath() {
  return path.join(getDataDir(), "settings.yaml");
}

function getAppConfigPath() {
  // 開発時は 20_app/resources、配布版は _app/resources を参照する。
  if (COTASKA_RESOURCE_ROOT_DIR === COTASKA_ROOT_DIR) {
    return path.resolve(__dirname, "../../resources", APP_CONFIG_FILENAME);
  }
  return path.join(COTASKA_RESOURCE_ROOT_DIR, APP_CONFIG_FILENAME);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function loadAppConfig() {
  const configPath = getAppConfigPath();
  try {
    const parsed = yaml.load(fs.readFileSync(configPath, "utf8")) || {};
    const update = parsed.update || {};
    if (!isHttpUrl(update.latestVersionUrl) || !isHttpUrl(update.downloadPageUrl)) {
      throw new Error("update.latestVersionUrl または update.downloadPageUrl が不正です。");
    }
    return {
      config: {
        update: {
          latestVersionUrl: String(update.latestVersionUrl).trim(),
          downloadPageUrl: String(update.downloadPageUrl).trim(),
        },
      },
      path: configPath,
      error: null,
    };
  } catch (err) {
    const message = `アプリ配布設定 ${configPath} を読み込めないため、既定の更新URLを使用します: ${err.message}`;
    console.warn(message);
    return { config: DEFAULT_APP_CONFIG, path: configPath, error: message };
  }
}

// aiChat 設定をネスト構造へマージする。
// 旧フラットキー（aiChat.sandboxMode / performanceMode / model）が存在し、
// 新ネスト（aiChat.codex）が無い場合は codex 配下へ後方互換移行する。
function mergeAiChat(rawAiChat) {
  const src = rawAiChat && typeof rawAiChat === "object" ? rawAiChat : {};
  const def = DEFAULT_SETTINGS.aiChat;
  const legacyCodex = !src.codex || typeof src.codex !== "object";
  const codexSrc = legacyCodex ? {} : src.codex;
  const claudeSrc = src.claude && typeof src.claude === "object" ? src.claude : {};
  const bedrockSrc = claudeSrc.bedrock && typeof claudeSrc.bedrock === "object" ? claudeSrc.bedrock : {};

  // 旧フラットキーからの移行元（codex ネストが無い場合のみ参照）
  const legacySandbox = legacyCodex ? src.sandboxMode : undefined;
  const legacyPerformance = legacyCodex ? src.performanceMode : undefined;
  const legacyModel = legacyCodex ? src.model : undefined;

  return {
    provider: normalizeAiProvider(src.provider),
    workdir: hasOwn(src, "workdir") ? normalizeAiWorkdir(src.workdir) : def.workdir,
    referenceSendMode: normalizeReferenceSendMode(src.referenceSendMode),
    diagnosticsEnabled: src.diagnosticsEnabled === true,
    retentionDays: clampNumber(src.retentionDays, 1, 3650, def.retentionDays),
    maxReferenceFiles: clampNumber(src.maxReferenceFiles, 1, 100, def.maxReferenceFiles),
    maxReferenceChars: clampNumber(src.maxReferenceChars, 1000, 1000000, def.maxReferenceChars),
    codex: {
      model: String(codexSrc.model ?? legacyModel ?? def.codex.model),
      sandboxMode: normalizeSandboxMode(codexSrc.sandboxMode ?? legacySandbox),
      performanceMode: normalizePerformanceMode(codexSrc.performanceMode ?? legacyPerformance),
    },
    claude: {
      // 空文字は「自動」として有効な値のため、|| ではなく nullish 判定を使う。
      model: String(claudeSrc.model ?? def.claude.model),
      performanceMode: normalizePerformanceMode(claudeSrc.performanceMode),
      authMode: normalizeClaudeAuthMode(claudeSrc.authMode),
      permissionMode: normalizeClaudePermissionMode(claudeSrc.permissionMode),
      bedrock: {
        region: String(bedrockSrc.region || ""),
        modelId: String(bedrockSrc.modelId || ""),
        awsProfile: String(bedrockSrc.awsProfile || ""),
      },
    },
  };
}

// Bedrock 認証時の必須項目を検証する。
// provider=claude かつ claude.authMode=bedrock のとき region/modelId/awsProfile を必須とする。
function validateAiChatBedrock(aiChat) {
  if (!aiChat || aiChat.provider !== "claude") return;
  if (aiChat.claude?.authMode !== "bedrock") return;
  const bedrock = aiChat.claude.bedrock || {};
  const missing = [];
  if (!String(bedrock.region || "").trim()) missing.push("Bedrockリージョン");
  if (!String(bedrock.modelId || "").trim()) missing.push("BedrockモデルID");
  if (!String(bedrock.awsProfile || "").trim()) missing.push("AWSプロファイル名");
  if (missing.length > 0) {
    throw new Error(`認証方式がクラウドプロバイダ（Amazon Bedrock）の場合、次の項目は必須です: ${missing.join(" / ")}`);
  }
}

function mergeSettings(raw, appConfig = DEFAULT_APP_CONFIG) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    displayName: String(source.displayName || DEFAULT_SETTINGS.displayName).trim() || DEFAULT_SETTINGS.displayName,
    externalEditorPath: String(source.externalEditorPath || ""),
    startup: {
      ...DEFAULT_SETTINGS.startup,
      ...(source.startup || {}),
      initialView: normalizeStartupInitialView(source.startup?.initialView),
    },
    onboarding: {
      ...DEFAULT_SETTINGS.onboarding,
      ...(source.onboarding || {}),
      completed: Boolean(source.onboarding?.completed),
    },
    notification: {
      ...DEFAULT_SETTINGS.notification,
      ...(source.notification || {}),
      minutesBefore: clampNumber(source.notification?.minutesBefore, 0, 1440, DEFAULT_SETTINGS.notification.minutesBefore),
    },
    detailTextSize: clampNumber(source.detailTextSize, 10, 28, DEFAULT_SETTINGS.detailTextSize),
    taskLoading: {
      ...DEFAULT_SETTINGS.taskLoading,
      ...(source.taskLoading || {}),
      completedInitialLimit: clampNumber(source.taskLoading?.completedInitialLimit, 0, 1000, DEFAULT_SETTINGS.taskLoading.completedInitialLimit),
      completedLoadMoreLimit: clampNumber(source.taskLoading?.completedLoadMoreLimit, 1, 1000, DEFAULT_SETTINGS.taskLoading.completedLoadMoreLimit),
    },
    logging: {
      ...DEFAULT_SETTINGS.logging,
      ...(source.logging || {}),
      level: normalizeLogLevel(source.logging?.level),
    },
    aiChat: mergeAiChat(source.aiChat),
    // update は data/settings.yaml ではなく、_app/resources/app-config.yaml が唯一の管理元。
    update: appConfig.update,
  };
}

function renderSettingsYaml(settings) {
  const normalized = mergeSettings(settings);
  const escaped = (value) => JSON.stringify(String(value ?? ""));
  return [
    "# Cotaska 設定ファイル",
    "# このファイルは設定画面から更新されます。日本語コメントは保持されます。",
    "",
    "# 表示名: アプリ画面やタイトルに表示する名前",
    `displayName: ${escaped(normalized.displayName)}`,
    "",
    "# 外部エディタ: タスクファイルを開くときに使うエディタの実行ファイルパス",
    "# 空欄の場合は .md ファイルの既定アプリで開きます",
    `externalEditorPath: ${escaped(normalized.externalEditorPath)}`,
    "",
    "startup:",
    "  # 起動時に最初に開くビュー: すべて / 今日 / 明日 / 次の7日間",
    `  initialView: ${escaped(normalized.startup.initialView)}`,
    "",
    "onboarding:",
    "  # 初回利用ガイドを完了またはスキップしたか",
    `  completed: ${normalized.onboarding.completed ? "true" : "false"}`,
    "",
    "notification:",
    "  # 通知時間: 予定時刻の何分前に通知するか",
    `  minutesBefore: ${normalized.notification.minutesBefore}`,
    "",
    "# タスク詳細本文の文字サイズ(px)",
    `detailTextSize: ${normalized.detailTextSize}`,
    "",
    "taskLoading:",
    "  # 起動時に読み込む完了タスク件数",
    `  completedInitialLimit: ${normalized.taskLoading.completedInitialLimit}`,
    "",
    "  # 完了ビューで次を読み込む1回あたりの件数",
    `  completedLoadMoreLimit: ${normalized.taskLoading.completedLoadMoreLimit}`,
    "",
    "logging:",
    "  # App log level: debug / info / warn / error.",
    "  # Default info writes INFO, WARN, and ERROR to app-YYYY-MM-DD.log.",
    `  level: ${escaped(normalized.logging.level)}`,
    "",
    "aiChat:",
    "  # 連携先プロバイダ: codex / claude",
    `  provider: ${escaped(normalized.aiChat.provider)}`,
    "",
    "  # 作業フォルダ（両プロバイダ共通）。未設定時はAI画面で警告する",
    `  workdir: ${escaped(normalized.aiChat.workdir)}`,
    "",
    "  # 参照ファイルの送信方法: always / manual / skip-in-speed（共通）",
    `  referenceSendMode: ${escaped(normalized.aiChat.referenceSendMode)}`,
    "",
    "  # 応答時間・トークン数などの診断ログ。既定OFF（共通）",
    `  diagnosticsEnabled: ${normalized.aiChat.diagnosticsEnabled ? "true" : "false"}`,
    "",
    "  # AI関連SQLiteデータの削除既定日数（共通）",
    `  retentionDays: ${normalized.aiChat.retentionDays}`,
    "",
    "  # 参照ファイルの初期上限（共通）",
    `  maxReferenceFiles: ${normalized.aiChat.maxReferenceFiles}`,
    `  maxReferenceChars: ${normalized.aiChat.maxReferenceChars}`,
    "",
    "  # --- Codex 固有 ---",
    "  codex:",
    "    # Codexモデル名（空欄はアプリ既定）",
    `    model: ${escaped(normalized.aiChat.codex.model)}`,
    "    # sandbox mode: read-only / workspace-write / danger-full-access",
    `    sandboxMode: ${escaped(normalized.aiChat.codex.sandboxMode)}`,
    "    # performance mode: standard / speed",
    `    performanceMode: ${escaped(normalized.aiChat.codex.performanceMode)}`,
    "",
    "  # --- Claude Code 固有 ---",
    "  claude:",
    "    # Claudeモデル名（空欄は自動）",
    `    model: ${escaped(normalized.aiChat.claude.model)}`,
    "    # performance mode: standard / speed",
    `    performanceMode: ${escaped(normalized.aiChat.claude.performanceMode)}`,
    "    # 認証方式: local（ローカルサブスク・個人利用限定） / bedrock（クラウドプロバイダ・配布可）",
    `    authMode: ${escaped(normalized.aiChat.claude.authMode)}`,
    "    # 権限モード: plan / acceptEdits / bypassPermissions",
    `    permissionMode: ${escaped(normalized.aiChat.claude.permissionMode)}`,
    "    bedrock:",
    "      # AWSリージョン（authMode=bedrock時 必須）",
    `      region: ${escaped(normalized.aiChat.claude.bedrock.region)}`,
    "      # BedrockモデルID（authMode=bedrock時 必須）",
    `      modelId: ${escaped(normalized.aiChat.claude.bedrock.modelId)}`,
    "      # AWSプロファイル名のみ保存（authMode=bedrock時 必須）。実資格情報は ~/.aws に委ねる",
    `      awsProfile: ${escaped(normalized.aiChat.claude.bedrock.awsProfile)}`,
    "",
    "update:",
    "  # 最新版確認に使うURL。Cloudflare R2 の version.json または GitHub Releases latest API 互換JSONを想定します",
    `  latestVersionUrl: ${escaped(normalized.update.latestVersionUrl)}`,
    "",
    "  # ダウンロード先: 利用者確認後に開くURL",
    `  downloadPageUrl: ${escaped(normalized.update.downloadPageUrl)}`,
    "",
  ].join("\n").replace(/\nupdate:\n[\s\S]*$/, "\n");
}

function ensureSettingsFile() {
  migrateLegacyResourceData();
  fs.mkdirSync(getDataDir(), { recursive: true });
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, renderSettingsYaml(DEFAULT_SETTINGS), "utf8");
  }
}

function getSettings() {
  ensureSettingsFile();
  const settingsPath = getSettingsPath();
  const appConfig = loadAppConfig();
  try {
    const content = fs.readFileSync(settingsPath, "utf8");
    const parsed = yaml.load(content) || {};
    const settings = mergeSettings(parsed, appConfig.config);
    return {
      ok: true,
      settings,
      configured: {
        aiChatWorkdir: isAiWorkdirConfigured(settings),
      },
      path: settingsPath,
      appConfigPath: appConfig.path,
      appConfigError: appConfig.error,
    };
  } catch (err) {
    return {
      ok: false,
      settings: mergeSettings(DEFAULT_SETTINGS, appConfig.config),
      configured: {
        aiChatWorkdir: isAiWorkdirConfigured(DEFAULT_SETTINGS),
      },
      path: settingsPath,
      appConfigPath: appConfig.path,
      appConfigError: appConfig.error,
      error: err.message || "settings.yaml を読み込めませんでした。",
    };
  }
}

// updateSettings 用の aiChat 深いマージ。
// 部分パッチ（例: { provider } や { claude: { authMode } }）を現在値へ深くマージする。
function mergeAiChatPatch(current, patch) {
  const cur = current || {};
  const p = patch || {};
  return {
    ...cur,
    ...p,
    codex: { ...(cur.codex || {}), ...(p.codex || {}) },
    claude: {
      ...(cur.claude || {}),
      ...(p.claude || {}),
      bedrock: {
        ...((cur.claude || {}).bedrock || {}),
        ...((p.claude || {}).bedrock || {}),
      },
    },
  };
}

function updateSettings(patch) {
  const current = getSettings().settings;
  const next = mergeSettings({
    ...current,
    ...(patch || {}),
    notification: {
      ...current.notification,
      ...((patch || {}).notification || {}),
    },
    startup: {
      ...current.startup,
      ...((patch || {}).startup || {}),
    },
    taskLoading: {
      ...current.taskLoading,
      ...((patch || {}).taskLoading || {}),
    },
    logging: {
      ...current.logging,
      ...((patch || {}).logging || {}),
    },
    aiChat: mergeAiChatPatch(current.aiChat, (patch || {}).aiChat),
  });
  validateAiWorkdir(next.aiChat?.workdir);
  validateAiChatBedrock(next.aiChat);

  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(getSettingsPath(), renderSettingsYaml(next), "utf8");
  return {
    ok: true,
    settings: next,
    configured: {
      aiChatWorkdir: isAiWorkdirConfigured(next),
    },
    path: getSettingsPath(),
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  getDataDir,
  migrateLegacyResourceData,
  resolveCotaskaRootDir,
  getSettingsPath,
  getAppConfigPath,
  loadAppConfig,
  getSettings,
  updateSettings,
};
