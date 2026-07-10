const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const COTASKA_RESOURCE_ROOT_DIR = path.resolve(__dirname, "../../..");

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
    workdir: "",
    sandboxMode: "read-only",
    performanceMode: "standard",
    diagnosticsEnabled: false,
    retentionDays: 90,
    maxReferenceFiles: 10,
    maxReferenceChars: 100000,
    referenceSendMode: "always",
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

function normalizeSandboxMode(value, fallback = DEFAULT_SETTINGS.aiChat.sandboxMode) {
  const mode = String(value || fallback).trim();
  return ["read-only", "workspace-write", "danger-full-access"].includes(mode) ? mode : fallback;
}

function normalizePerformanceMode(value, fallback = DEFAULT_SETTINGS.aiChat.performanceMode) {
  const mode = String(value || fallback).trim();
  return ["standard", "speed"].includes(mode) ? mode : fallback;
}

function normalizeReferenceSendMode(value, fallback = DEFAULT_SETTINGS.aiChat.referenceSendMode) {
  const mode = String(value || fallback).trim();
  return ["always", "manual", "skip-in-speed"].includes(mode) ? mode : fallback;
}

function normalizeLogLevel(value, fallback = DEFAULT_SETTINGS.logging.level) {
  const level = String(value || fallback).trim().toLowerCase();
  return ["debug", "info", "warn", "error"].includes(level) ? level : fallback;
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

function mergeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sourceUpdate = source.update || {};
  const latestVersionUrl = String(sourceUpdate.latestVersionUrl || DEFAULT_SETTINGS.update.latestVersionUrl);
  const downloadPageUrl = String(sourceUpdate.downloadPageUrl || DEFAULT_SETTINGS.update.downloadPageUrl);
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    displayName: String(source.displayName || DEFAULT_SETTINGS.displayName).trim() || DEFAULT_SETTINGS.displayName,
    externalEditorPath: String(source.externalEditorPath || ""),
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
    aiChat: {
      ...DEFAULT_SETTINGS.aiChat,
      ...(source.aiChat || {}),
      workdir: hasOwn(source.aiChat, "workdir")
        ? normalizeAiWorkdir(source.aiChat?.workdir)
        : DEFAULT_SETTINGS.aiChat.workdir,
      sandboxMode: normalizeSandboxMode(source.aiChat?.sandboxMode),
      performanceMode: normalizePerformanceMode(source.aiChat?.performanceMode),
      referenceSendMode: normalizeReferenceSendMode(source.aiChat?.referenceSendMode),
      diagnosticsEnabled: source.aiChat?.diagnosticsEnabled === true,
      retentionDays: clampNumber(source.aiChat?.retentionDays, 1, 3650, DEFAULT_SETTINGS.aiChat.retentionDays),
      maxReferenceFiles: clampNumber(source.aiChat?.maxReferenceFiles, 1, 100, DEFAULT_SETTINGS.aiChat.maxReferenceFiles),
      maxReferenceChars: clampNumber(source.aiChat?.maxReferenceChars, 1000, 1000000, DEFAULT_SETTINGS.aiChat.maxReferenceChars),
    },
    update: {
      ...DEFAULT_SETTINGS.update,
      ...sourceUpdate,
      latestVersionUrl: LEGACY_DEFAULT_UPDATE.latestVersionUrls.includes(latestVersionUrl)
        ? DEFAULT_SETTINGS.update.latestVersionUrl
        : latestVersionUrl,
      downloadPageUrl: LEGACY_DEFAULT_UPDATE.downloadPageUrls.includes(downloadPageUrl)
        || downloadPageUrl === PREVIOUS_DEFAULT_UPDATE.downloadPageUrl
        ? DEFAULT_SETTINGS.update.downloadPageUrl
        : downloadPageUrl,
    },
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
    "  # Working directory passed to Codex SDK.",
    `  workdir: ${escaped(normalized.aiChat.workdir)}`,
    "",
    "  # Codex SDK sandbox mode: read-only / workspace-write / danger-full-access.",
    `  sandboxMode: ${escaped(normalized.aiChat.sandboxMode)}`,
    "",
    "  # AI response performance mode: standard / speed.",
    `  performanceMode: ${escaped(normalized.aiChat.performanceMode)}`,
    "",
    "  # Reference file send mode: always / manual / skip-in-speed.",
    `  referenceSendMode: ${escaped(normalized.aiChat.referenceSendMode)}`,
    "",
    "  # Enable detailed AI diagnostics logs for response time investigation.",
    `  diagnosticsEnabled: ${normalized.aiChat.diagnosticsEnabled ? "true" : "false"}`,
    "",
    "  # Days to keep archived AI data before cleanup.",
    `  retentionDays: ${normalized.aiChat.retentionDays}`,
    "",
    "  # Maximum reference files attached to one Codex turn.",
    `  maxReferenceFiles: ${normalized.aiChat.maxReferenceFiles}`,
    "",
    "  # Maximum total reference characters attached to one Codex turn.",
    `  maxReferenceChars: ${normalized.aiChat.maxReferenceChars}`,
    "",
    "update:",
    "  # 最新版確認に使うURL。Cloudflare R2 の version.json または GitHub Releases latest API 互換JSONを想定します",
    `  latestVersionUrl: ${escaped(normalized.update.latestVersionUrl)}`,
    "",
    "  # ダウンロード先: 利用者確認後に開くURL",
    `  downloadPageUrl: ${escaped(normalized.update.downloadPageUrl)}`,
    "",
  ].join("\n");
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
  try {
    const content = fs.readFileSync(settingsPath, "utf8");
    const parsed = yaml.load(content) || {};
    const settings = mergeSettings(parsed);
    return {
      ok: true,
      settings,
      configured: {
        aiChatWorkdir: isAiWorkdirConfigured(settings),
      },
      path: settingsPath,
    };
  } catch (err) {
    return {
      ok: false,
      settings: mergeSettings(DEFAULT_SETTINGS),
      configured: {
        aiChatWorkdir: isAiWorkdirConfigured(DEFAULT_SETTINGS),
      },
      path: settingsPath,
      error: err.message || "settings.yaml を読み込めませんでした。",
    };
  }
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
    taskLoading: {
      ...current.taskLoading,
      ...((patch || {}).taskLoading || {}),
    },
    logging: {
      ...current.logging,
      ...((patch || {}).logging || {}),
    },
    aiChat: {
      ...current.aiChat,
      ...((patch || {}).aiChat || {}),
    },
    update: {
      ...current.update,
      ...((patch || {}).update || {}),
    },
  });
  validateAiWorkdir(next.aiChat?.workdir);

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
  getSettings,
  updateSettings,
};
