const path = require("path");

let currentProject = null;

function normalizeProjectRoot(rootDir) {
  const value = String(rootDir || "").trim();
  if (!value || !path.isAbsolute(value)) throw new Error("プロジェクトフォルダの絶対パスが必要です。");
  return path.resolve(value);
}

function buildProject(rootDir, manifest) {
  const root = normalizeProjectRoot(rootDir);
  return Object.freeze({
    rootDir: root,
    projectFile: path.join(root, "project.yaml"),
    tasksDir: path.join(root, "tasks"),
    indexFile: path.join(root, "tasks", "_index.yaml"),
    archiveDir: path.join(root, "archive"),
    listsFile: path.join(root, "lists.yaml"),
    aiDatabaseFile: path.join(root, "ai.sqlite"),
    manifest: Object.freeze({ ...manifest }),
    projectId: manifest.projectId,
    name: manifest.name,
  });
}

function setCurrent(rootDir, manifest) {
  currentProject = buildProject(rootDir, manifest);
  return currentProject;
}

function clear() { currentProject = null; }
function hasCurrent() { return Boolean(currentProject); }
function getCurrent() {
  if (!currentProject) throw new Error("プロジェクトが選択されていません。");
  return currentProject;
}
function getCurrentOrNull() { return currentProject; }

module.exports = { setCurrent, clear, hasCurrent, getCurrent, getCurrentOrNull, normalizeProjectRoot };
