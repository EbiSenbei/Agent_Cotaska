const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const projectContext = require("./projectContext");

const BACKUP_FORMAT_VERSION = 1;

function copyDirectoryWithoutGeneratedFiles(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    force: true,
    filter: (source) => path.basename(source) !== "_index.yaml",
  });
}

function replaceDirectoryContents(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
    const target = path.join(to, entry.name);
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  copyDirectoryWithoutGeneratedFiles(from, to);
}

function toZipPath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/");
}

function addPathToZip(zip, sourcePath, archivePath) {
  if (!fs.existsSync(sourcePath)) return;

  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      if (entry.name === "_index.yaml") continue;
      addPathToZip(zip, path.join(sourcePath, entry.name), path.join(archivePath, entry.name));
    }
    return;
  }

  zip.addFile(toZipPath(archivePath), fs.readFileSync(sourcePath));
}

function createBackupService({
  appVersion,
  appDisplayName,
  getDefaultBackupDir,
  getMainWindow,
  settingsService,
  taskService,
  watcher,
}) {
  function createBackupZip(targetDir, options = {}) {
    const requestedTargetDir = String(targetDir || "").trim();
    const rawTargetDir = requestedTargetDir || getDefaultBackupDir();

    const resolvedTargetDir = path.resolve(rawTargetDir);
    if (fs.existsSync(resolvedTargetDir) && !fs.statSync(resolvedTargetDir).isDirectory()) {
      return { ok: false, error: "バックアップ保存先に同名のファイルが存在します。" };
    }
    fs.mkdirSync(resolvedTargetDir, { recursive: true });

    const project = projectContext.getCurrent();
    const dataDir = project.rootDir;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = options.prefix ? `${options.prefix}-${timestamp}` : `Cotaska-backup-${timestamp}`;
    const backupPath = path.join(resolvedTargetDir, `${baseName}.zip`);
    const zip = new AdmZip();
    const copied = [];

    const manifest = {
      app: "Cotaska",
      productName: appDisplayName,
      format: "cotaska-backup",
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      appVersion,
      projectId: project.projectId,
      schemaVersion: project.manifest.schemaVersion,
      excludes: ["tasks/_index.yaml"],
    };
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

    const addIfExists = (from, archivePath) => {
      if (!fs.existsSync(from)) return;
      addPathToZip(zip, from, archivePath);
      copied.push(toZipPath(archivePath));
    };

    addIfExists(project.projectFile, "project.yaml");
    addIfExists(project.tasksDir, "tasks");
    addIfExists(project.archiveDir, "archive");
    addIfExists(project.listsFile, "lists.yaml");
    addIfExists(project.aiDatabaseFile, "ai.sqlite");

    zip.writeZip(backupPath);

    return { ok: true, backupPath, copied, format: "zip" };
  }

  function extractBackupZip(sourceZipPath) {
    const zip = new AdmZip(sourceZipPath);
    const entries = zip.getEntries();
    const hasUnsafeEntry = entries.some((entry) => {
      const entryName = entry.entryName.replace(/\\/g, "/");
      return path.isAbsolute(entryName) || entryName.includes("../") || entryName.startsWith("../");
    });
    if (hasUnsafeEntry) {
      throw new Error("バックアップzipに不正なパスが含まれています。");
    }

    const manifestEntry = zip.getEntry("manifest.json");
    if (manifestEntry) {
      const manifest = JSON.parse(zip.readAsText(manifestEntry));
      if (manifest.format && manifest.format !== "cotaska-backup") {
        throw new Error("Cotaskaのバックアップzipではありません。");
      }
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-restore-"));
    zip.extractAllTo(tempDir, true);
    return tempDir;
  }

  function resolveBackupSource(sourcePath) {
    const rawSourcePath = String(sourcePath || "").trim();
    if (!rawSourcePath) return { ok: false, error: "復元元バックアップを選択してください。" };

    const resolvedSourcePath = path.resolve(rawSourcePath);
    if (!fs.existsSync(resolvedSourcePath)) {
      return { ok: false, error: "復元元バックアップが見つかりません。" };
    }

    const stat = fs.statSync(resolvedSourcePath);
    if (stat.isFile()) {
      if (path.extname(resolvedSourcePath).toLowerCase() !== ".zip") {
        return { ok: false, error: "復元元には Cotaska のバックアップzipを選択してください。" };
      }
      try {
        return { ok: true, backupRoot: extractBackupZip(resolvedSourcePath), resolvedSourcePath, cleanup: true };
      } catch (err) {
        return { ok: false, error: err.message || "バックアップzipを展開できませんでした。" };
      }
    }

    if (stat.isDirectory()) {
      return { ok: true, backupRoot: resolvedSourcePath, resolvedSourcePath, cleanup: false };
    }

    return { ok: false, error: "復元元バックアップを選択してください。" };
  }

  function createBackup(targetDir) {
    return createBackupZip(targetDir);
  }

  async function restoreBackup(sourcePath) {
    const source = resolveBackupSource(sourcePath);
    if (!source.ok) return source;

    const backupDataDir = fs.existsSync(path.join(source.backupRoot, "tasks")) ? source.backupRoot : path.join(source.backupRoot, "data");
    const backupTasksDir = path.join(backupDataDir, "tasks");
    if (!fs.existsSync(backupTasksDir) || !fs.statSync(backupTasksDir).isDirectory()) {
      if (source.cleanup) {
        fs.rmSync(source.backupRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
      return { ok: false, error: "復元元に data/tasks フォルダがありません。" };
    }

    const project = projectContext.getCurrent();
    const dataDir = project.rootDir;
    const preRestoreBackup = createBackupZip(getDefaultBackupDir(), { prefix: "Cotaska-pre-restore" });
    if (!preRestoreBackup.ok) {
      if (source.cleanup) {
        fs.rmSync(source.backupRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
      return { ok: false, error: `復元前バックアップを作成できませんでした: ${preRestoreBackup.error}` };
    }

    const restoreFile = (from, to) => {
      if (!fs.existsSync(from)) return;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    };

    await watcher.stopWatcher();
    try {
      replaceDirectoryContents(backupTasksDir, path.join(dataDir, "tasks"));
      restoreFile(path.join(backupDataDir, "lists.yaml"), path.join(dataDir, "lists.yaml"));
      restoreFile(path.join(backupDataDir, "ai.sqlite"), path.join(dataDir, "ai.sqlite"));
      if (fs.existsSync(path.join(backupDataDir, "archive"))) replaceDirectoryContents(path.join(backupDataDir, "archive"), path.join(dataDir, "archive"));

      const rebuild = taskService.rebuildCache();
      if (!rebuild.success) {
        return { ok: false, error: `復元後のタスク再読み込みに失敗しました: ${rebuild.error}` };
      }
      const indexService = require("./indexService");
      const indexResult = indexService.rebuildIndex(taskService.getCache(), taskService.getTaskFileRoots());

      return {
        ok: true,
        restoredFrom: source.resolvedSourcePath,
        preRestoreBackupPath: preRestoreBackup.backupPath,
        taskCount: rebuild.taskCount || 0,
        index: indexResult,
      };
    } finally {
      await watcher.startWatcher(getMainWindow());
      if (source.cleanup) {
        fs.rmSync(source.backupRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  }

  return {
    createBackup,
    restoreBackup,
  };
}

module.exports = { createBackupService };
