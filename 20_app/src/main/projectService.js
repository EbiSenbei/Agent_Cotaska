const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const YAML = require("js-yaml");
const projectContext = require("./projectContext");

const SCHEMA_VERSION = 1;
let appDataDir = null;

function configure(userDataDir) {
  appDataDir = path.resolve(userDataDir);
  fs.mkdirSync(appDataDir, { recursive: true });
}
function requireConfigured() { if (!appDataDir) throw new Error("Project service is not configured."); }
function recentPath() { requireConfigured(); return path.join(appDataDir, "recent-projects.yaml"); }
function now() { return new Date().toISOString(); }
function safeName(value, rootDir) { return String(value || path.basename(rootDir) || "cotaska").trim().slice(0, 80) || "cotaska"; }

function readRecent() {
  try {
    const parsed = YAML.load(fs.readFileSync(recentPath(), "utf8")) || {};
    return { lastProjectId: parsed.lastProjectId || null, projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch { return { lastProjectId: null, projects: [] }; }
}
function writeRecent(data) {
  fs.writeFileSync(recentPath(), YAML.dump(data, { lineWidth: -1 }), "utf8");
}
function publicProject(project, exists = true) {
  return { projectId: project.projectId, name: project.name, path: project.rootDir || project.path, exists };
}
function remember(project) {
  const data = readRecent();
  const entry = { projectId: project.projectId, name: project.name, path: project.rootDir, lastOpenedAt: now() };
  data.projects = [entry, ...data.projects.filter((x) => x.projectId !== entry.projectId && path.resolve(x.path || ".") !== entry.path)].slice(0, 20);
  data.lastProjectId = entry.projectId;
  writeRecent(data);
}
function validateManifest(manifest) {
  if (!manifest || Number(manifest.schemaVersion) !== SCHEMA_VERSION) throw new Error("対応していないproject.yamlです。");
  if (!String(manifest.projectId || "").trim()) throw new Error("project.yamlにprojectIdがありません。");
  if (!String(manifest.name || "").trim()) throw new Error("project.yamlにnameがありません。");
}
function ensureWritable(rootDir) {
  fs.accessSync(rootDir, fs.constants.R_OK | fs.constants.W_OK);
}
function openProject(rootDir) {
  const root = projectContext.normalizeProjectRoot(rootDir);
  const projectFile = path.join(root, "project.yaml");
  if (!fs.existsSync(projectFile)) throw new Error("選択したフォルダにproject.yamlがありません。");
  ensureWritable(root);
  const manifest = YAML.load(fs.readFileSync(projectFile, "utf8"));
  validateManifest(manifest);
  const project = projectContext.setCurrent(root, manifest);
  remember(project);
  return publicProject(project);
}
function createProject(rootDir, name) {
  const root = projectContext.normalizeProjectRoot(rootDir);
  fs.mkdirSync(root, { recursive: true });
  ensureWritable(root);
  const owned = ["project.yaml", "tasks", "archive", "lists.yaml", "ai.sqlite"];
  const collisions = owned.filter((entry) => fs.existsSync(path.join(root, entry)));
  if (collisions.length) throw new Error(`Cotaska管理ファイルが既に存在します: ${collisions.join(", ")}`);
  const timestamp = now();
  const manifest = { schemaVersion: SCHEMA_VERSION, projectId: crypto.randomUUID(), name: safeName(name, root), createdAt: timestamp, updatedAt: timestamp, ai: { workdir: "." } };
  fs.mkdirSync(path.join(root, "tasks"));
  fs.mkdirSync(path.join(root, "archive"));
  fs.writeFileSync(path.join(root, "lists.yaml"), YAML.dump({ lists: [], tags: [], last_updated: timestamp }), "utf8");
  fs.writeFileSync(path.join(root, "tasks", "_index.yaml"), YAML.dump({ tasks: [], task_file_roots: ["."], next_task_id: 1, last_updated: timestamp }), "utf8");
  fs.writeFileSync(path.join(root, "project.yaml"), YAML.dump(manifest, { lineWidth: -1 }), "utf8");
  const project = projectContext.setCurrent(root, manifest);
  remember(project);
  return publicProject(project);
}
function listRecent() {
  return readRecent().projects.map((entry) => ({ ...entry, exists: fs.existsSync(path.join(entry.path || "", "project.yaml")) }));
}
function getCurrent() { const project = projectContext.getCurrentOrNull(); return project ? publicProject(project) : null; }
function removeRecent(projectId) { const data = readRecent(); data.projects = data.projects.filter((x) => x.projectId !== projectId); if (data.lastProjectId === projectId) data.lastProjectId = null; writeRecent(data); return { ok: true }; }
function getStartupProject(argv = []) {
  const idx = argv.indexOf("--project");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  const data = readRecent();
  return data.projects.find((x) => x.projectId === data.lastProjectId && fs.existsSync(path.join(x.path || "", "project.yaml")))?.path || null;
}

function findLegacyDataDir(sourceRoot) {
  const root = projectContext.normalizeProjectRoot(sourceRoot);
  return [path.join(root, "data"), path.join(root, "_app", "resources", "data"), path.join(root, "_app", "resources", "30_data"), root]
    .find((candidate) => fs.existsSync(path.join(candidate, "tasks"))) || null;
}
function copyTree(source, target, excludeIndex = false) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excludeIndex && entry.name === "_index.yaml") continue;
    const from = path.join(source, entry.name); const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to, excludeIndex); else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}
function migrateLegacy(sourceRoot, targetRoot, name) {
  const sourceData = findLegacyDataDir(sourceRoot);
  if (!sourceData) throw new Error("移行元にtasksフォルダが見つかりません。");
  const target = projectContext.normalizeProjectRoot(targetRoot);
  if (target === sourceData || target.startsWith(`${sourceData}${path.sep}`) || sourceData.startsWith(`${target}${path.sep}`)) throw new Error("移行元と移行先に包含関係があります。");
  fs.mkdirSync(target, { recursive: true });
  const collisions = ["project.yaml", "tasks", "archive", "lists.yaml", "ai.sqlite"].filter((entry) => fs.existsSync(path.join(target, entry)));
  if (collisions.length) throw new Error(`移行先にCotaska管理ファイルがあります: ${collisions.join(", ")}`);
  const timestamp = now();
  const manifest = { schemaVersion: SCHEMA_VERSION, projectId: crypto.randomUUID(), name: safeName(name, target), createdAt: timestamp, updatedAt: timestamp, ai: { workdir: "." }, migratedFrom: path.resolve(sourceRoot) };
  copyTree(path.join(sourceData, "tasks"), path.join(target, "tasks"), true);
  if (fs.existsSync(path.join(sourceData, "archive"))) copyTree(path.join(sourceData, "archive"), path.join(target, "archive")); else fs.mkdirSync(path.join(target, "archive"));
  if (fs.existsSync(path.join(sourceData, "lists.yaml"))) fs.copyFileSync(path.join(sourceData, "lists.yaml"), path.join(target, "lists.yaml")); else fs.writeFileSync(path.join(target, "lists.yaml"), YAML.dump({ lists: [], tags: [] }), "utf8");
  if (fs.existsSync(path.join(sourceData, "ai.sqlite"))) fs.copyFileSync(path.join(sourceData, "ai.sqlite"), path.join(target, "ai.sqlite"));
  fs.writeFileSync(path.join(target, "project.yaml"), YAML.dump(manifest, { lineWidth: -1 }), "utf8");
  const project = projectContext.setCurrent(target, manifest); remember(project); return publicProject(project);
}

module.exports = { configure, openProject, createProject, migrateLegacy, listRecent, getCurrent, removeRecent, getStartupProject };
