const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

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
  update: {
    latestVersionUrl: "https://pub-d671fdad660b43a8a4b99ede58b7c092.r2.dev/latest/version.json",
    downloadPageUrl: "https://ebisenbei.github.io/cotaska-site/download.html",
  },
};

const LEGACY_DEFAULT_UPDATE = {
  latestVersionUrl: "https://api.github.com/repos/EbiSenbei/Agent_Cotaska/releases/latest",
  downloadPageUrl: "https://github.com/EbiSenbei/Agent_Cotaska/releases",
};

const PREVIOUS_DEFAULT_UPDATE = {
  downloadPageUrl: "https://pub-d671fdad660b43a8a4b99ede58b7c092.r2.dev/latest/Cotaska-Portable.zip",
};

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function getDataDir() {
  return path.resolve(process.cwd(), "../data");
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
    update: {
      ...DEFAULT_SETTINGS.update,
      ...sourceUpdate,
      latestVersionUrl: latestVersionUrl === LEGACY_DEFAULT_UPDATE.latestVersionUrl
        ? DEFAULT_SETTINGS.update.latestVersionUrl
        : latestVersionUrl,
      downloadPageUrl: downloadPageUrl === LEGACY_DEFAULT_UPDATE.downloadPageUrl
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
    return {
      ok: true,
      settings: mergeSettings(parsed),
      path: settingsPath,
    };
  } catch (err) {
    return {
      ok: false,
      settings: mergeSettings(DEFAULT_SETTINGS),
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
    update: {
      ...current.update,
      ...((patch || {}).update || {}),
    },
  });

  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(getSettingsPath(), renderSettingsYaml(next), "utf8");
  return {
    ok: true,
    settings: next,
    path: getSettingsPath(),
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  getDataDir,
  getSettingsPath,
  getSettings,
  updateSettings,
};
