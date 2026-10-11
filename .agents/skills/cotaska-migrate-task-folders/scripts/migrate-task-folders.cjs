#!/usr/bin/env node
// Run with the repository's 20_app dependencies installed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const YAML = createRequire(path.resolve(__dirname, '../../../../20_app/package.json'))('js-yaml');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function inventory(root) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`リンクは移行対象にできません: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result.push({ path: path.relative(root, file), sha256: hash(file) });
      else throw new Error(`通常ファイルではありません: ${file}`);
    }
  }
  walk(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function plan(root) {
  const tasks = path.join(root, 'tasks');
  if (!fs.statSync(tasks).isDirectory()) throw new Error('tasks フォルダが必要です');
  const seen = new Set();
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`リンクは扱えません: ${source}`);
      if (entry.isDirectory()) {
        if (entry.name !== 'attachments') walk(source);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const id = entry.name.match(/^(T-\d+)\.md$/)?.[1];
      if (!id) throw new Error(`タスク以外のMarkdownがあります: ${source}`);
      const text = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
      const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match || YAML.load(match[1])?.id !== id) throw new Error(`frontmatter IDが一致しません: ${source}`);
      if (seen.has(id)) throw new Error(`ID重複: ${id}`);
      seen.add(id);
      const migrated = path.basename(dir) === id;
      const destination = migrated ? source : path.join(dir, id, entry.name);
      if (!migrated && fs.existsSync(path.dirname(destination))) {
        throw new Error(`移動先フォルダが既にあります: ${destination}`);
      }
      result.push({ id, source: path.relative(root, source), destination: path.relative(root, destination), sha256: hash(source), migrated });
    }
  }
  walk(tasks);
  if (!result.length) throw new Error('タスクが見つかりません');
  return result;
}

function migrate({ root, backupDir, apply = false, appStopped = false, compatibleApp = false }) {
  root = fs.realpathSync(root);
  const tasks = plan(root);
  const pending = tasks.filter((t) => !t.migrated);
  if (!apply || !pending.length) return { mode: apply ? 'already-migrated' : 'dry-run', root, tasks, pending: pending.length };
  if (!appStopped || !compatibleApp) throw new Error('適用には --app-stopped と --compatible-app が必要です');
  if (!backupDir) throw new Error('--backup-dir が必要です');
  let ancestor = path.resolve(backupDir);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  backupDir = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, path.resolve(backupDir)));
  const relative = path.relative(root, backupDir);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('バックアップ先は対象データフォルダの外に指定してください');
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const original = inventory(root);
  const runDir = fs.mkdtempSync(path.join(backupDir, 'cotaska-migration-'));
  const snapshot = path.join(runDir, 'snapshot');
  fs.cpSync(root, snapshot, { recursive: true, errorOnExist: true, force: false });
  if (JSON.stringify(original) !== JSON.stringify(inventory(snapshot)) || JSON.stringify(original) !== JSON.stringify(inventory(root))) {
    throw new Error(`バックアップ照合失敗。実データは未移行です: ${runDir}`);
  }
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ root, createdAt: new Date().toISOString(), original, tasks }, null, 2), { flag: 'wx' });
  const log = (event) => fs.appendFileSync(path.join(runDir, 'journal.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n');
  for (const task of pending) {
    const source = path.join(root, task.source);
    const destination = path.join(root, task.destination);
    if (hash(source) !== task.sha256 || fs.existsSync(path.dirname(destination))) throw new Error(`実行中に変更/衝突を検出: ${task.id}`);
    log({ action: 'begin', ...task });
    fs.mkdirSync(path.dirname(destination));
    fs.renameSync(source, destination);
    if (hash(destination) !== task.sha256) throw new Error(`内容照合失敗: ${task.id}`);
    log({ action: 'moved', id: task.id });
  }
  const expected = original.map((file) => ({ ...file, path: tasks.find((t) => t.source === file.path)?.destination || file.path })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(expected) !== JSON.stringify(inventory(root))) throw new Error(`移行後の全ファイル照合失敗: ${runDir}`);
  log({ action: 'verified', taskCount: tasks.length });
  return { mode: 'applied', root, moved: pending.length, taskCount: tasks.length, runDir, index: '対応版Cotaskaで再生成してください' };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (['--root', '--backup-dir'].includes(key)) {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${key} に値が必要です`);
        options[key === '--root' ? 'root' : 'backupDir'] = path.resolve(args[++i]);
      } else if (['--apply', '--app-stopped', '--compatible-app'].includes(key)) {
        options[{ '--apply': 'apply', '--app-stopped': 'appStopped', '--compatible-app': 'compatibleApp' }[key]] = true;
      } else throw new Error(`不明な引数: ${key}`);
    }
    if (!options.root) throw new Error('使用法: node migrate-task-folders.cjs --root <tasksの親フォルダ> [--apply --backup-dir <外部フォルダ> --app-stopped --compatible-app]');
    console.log(JSON.stringify(migrate(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { migrate, plan };
