const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const context = require('../../src/main/projectContext');
const tasks = require('../../src/main/taskService');
const { createAttachmentService } = require('../../src/main/taskFileBundle');
const { createBackupService } = require('../../src/main/backupService');

let sandbox;
let root;
let attachments;
beforeEach(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-bundle-'));
  root = path.join(sandbox, 'project');
  fs.mkdirSync(root);
  context.setCurrent(root, { projectId: 'test', schemaVersion: 1, name: 'test' });
  fs.writeFileSync(path.join(root, 'settings.yaml'), '{}');
  await tasks.openTaskService();
  attachments = createAttachmentService(tasks);
});
afterEach(() => { context.clear(); fs.rmSync(sandbox, { recursive: true, force: true }); });

function source(name, content = '資料') {
  const file = path.join(sandbox, name);
  fs.writeFileSync(file, content);
  return file;
}
function backupService() {
  return createBackupService({ appVersion: 'test', appDisplayName: 'Cotaska', getDefaultBackupDir: () => path.join(sandbox, 'backups'), getMainWindow: () => null, settingsService: {}, taskService: tasks, watcher: { stopWatcher: async () => {}, startWatcher: async () => {} } });
}

test('mixed files and a directory are rejected before copying any file', () => {
  const task = tasks.addTask({ title: 'ドロップ' });
  const original = source('元ファイル.txt', 'コピー元を保持');
  const directory = path.join(sandbox, 'フォルダ');
  fs.mkdirSync(directory);
  expect(() => attachments.add(task.id, [original, directory])).toThrow();
  expect(attachments.list(task.id).files).toHaveLength(0);
  expect(fs.readFileSync(original, 'utf8')).toBe('コピー元を保持');
  attachments.add(task.id, [original]);
  expect(fs.readFileSync(original, 'utf8')).toBe('コピー元を保持');
  expect(fs.readFileSync(attachments.file(task.id, '元ファイル.txt'), 'utf8')).toBe('コピー元を保持');
});

test('new tasks, attachment Markdown exclusion, safe names, removal and restore', async () => {
  const task = tasks.addTask({ title: '添付' });
  expect(tasks.getTaskFilePath(task.id)).toBe(path.join(root, 'tasks', task.id, `${task.id}.md`));
  const original = source('資料.md', '---\nid: T-9999\n---\n添付');
  expect(attachments.add(task.id, [original])).toEqual(['資料.md']);
  expect(attachments.add(task.id, [original])).toEqual(['資料 (2).md']);
  expect(tasks.applyFileChange('add', attachments.file(task.id, '資料.md')).ignored).toBe(true);
  expect(tasks.rebuildCache().success).toBe(true);
  expect(tasks.getAllTasks().map((t) => t.id)).toEqual([task.id]);
  expect(() => attachments.file(task.id, '../資料.md')).toThrow();
  expect(() => attachments.file(task.id, 'x:y')).toThrow();
  const token = attachments.remove(task.id, '資料.md');
  attachments.add(task.id, [original]);
  expect(attachments.restore(task.id, token)).toBe('資料 (3).md');
  expect(attachments.list(task.id).removed).toHaveLength(0);
  tasks.trashTask(task.id);
  expect(attachments.list(task.id).files).toHaveLength(3);
  expect(() => attachments.add(task.id, [original])).toThrow();
  expect(() => attachments.remove(task.id, '資料.md')).toThrow();
  tasks.restoreTask(task.id);
  expect(attachments.list(task.id).files).toHaveLength(3);
  attachments.add(task.id, [source('.env.example', '非公開でない設定例')]);
  expect(attachments.list(task.id).files.some((file) => file.name === '.env.example')).toBe(true);
});

test('legacy task stays readable and moves only when adding an attachment', async () => {
  const file = path.join(root, 'tasks/T-0020.md');
  fs.writeFileSync(file, '---\nid: T-0020\ntitle: 旧形式\nstatus: todo\ndelete_flag: 0\n---\n本文\n');
  const bytes = fs.readFileSync(file);
  tasks.rebuildCache();
  expect(attachments.list('T-0020').files).toHaveLength(0);
  expect(fs.existsSync(file)).toBe(true);
  attachments.add('T-0020', [source('a.txt')]);
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.readFileSync(tasks.getTaskFilePath('T-0020'))).toEqual(bytes);
  tasks.applyFileChange('unlink', file);
  expect(tasks.getTaskById('T-0020')).not.toBeNull();
});

test('duplicate includes body and removed files; archive ZIP is byte exact', () => {
  const task = tasks.addTask({ title: '複製' });
  tasks.updateTaskContent(task.id, '[資料](attachments/a.txt)');
  attachments.add(task.id, [source('a.txt', '添付本文'), source('b.txt', '外した資料')]);
  attachments.remove(task.id, 'b.txt');
  const duplicate = tasks.duplicateTask(task.id);
  expect(duplicate.content).toContain('attachments/a.txt');
  expect(attachments.list(duplicate.id).files).toHaveLength(1);
  expect(attachments.list(duplicate.id).removed).toHaveLength(1);
  fs.writeFileSync(path.join(tasks.getTaskBaseDir(task.id), 'extra.txt'), 'その他資料');
  tasks.trashTask(task.id);
  tasks.deleteTask(task.id);
  const archived = path.join(root, 'archive', task.id);
  expect(fs.existsSync(path.join(archived, `${task.id}.md`))).toBe(true);
  expect(fs.readFileSync(path.join(archived, 'extra.txt'), 'utf8')).toBe('その他資料');
  expect(fs.existsSync(path.join(archived, 'attachments'))).toBe(false);
  const zip = new AdmZip(path.join(archived, 'attachments.zip'));
  expect(zip.readAsText('a.txt')).toBe('添付本文');
  expect(zip.getEntries().some((e) => e.entryName.startsWith('.removed/'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'tasks', task.id))).toBe(false);
  expect(attachments.list(duplicate.id).files).toHaveLength(1);
});

test('archive collision or ZIP collision preserves source task and attachments', () => {
  const task = tasks.addTask({ title: '衝突' });
  attachments.add(task.id, [source('a.txt')]);
  fs.mkdirSync(path.join(root, 'archive', task.id), { recursive: true });
  expect(() => tasks.deleteTask(task.id)).toThrow(/既に/);
  fs.rmdirSync(path.join(root, 'archive', task.id));
  fs.writeFileSync(path.join(tasks.getTaskBaseDir(task.id), 'attachments.zip'), '既存資料');
  expect(() => tasks.deleteTask(task.id)).toThrow(/既に/);
  expect(fs.existsSync(tasks.getTaskFilePath(task.id))).toBe(true);
  expect(attachments.list(task.id).files).toHaveLength(1);
});

test('attachment folder junction is rejected for read, write and archive', () => {
  const task = tasks.addTask({ title: 'リンク禁止' });
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'outside.txt'), '移動しない資料');
  const link = path.join(tasks.getTaskBaseDir(task.id), 'attachments');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => attachments.list(task.id)).toThrow();
  expect(() => attachments.add(task.id, [source('a.txt')])).toThrow();
  expect(() => tasks.deleteTask(task.id)).toThrow();
  expect(fs.readFileSync(path.join(outside, 'outside.txt'), 'utf8')).toBe('移動しない資料');
  expect(fs.existsSync(tasks.getTaskFilePath(task.id))).toBe(true);
});

test('backup restores new attachment folders, removed files and archive ZIP', async () => {
  const task = tasks.addTask({ title: 'バックアップ' });
  attachments.add(task.id, [source('a.txt'), source('b.txt'), source('_index.yaml', '添付インデックス')]);
  attachments.remove(task.id, 'b.txt');
  const archived = tasks.duplicateTask(task.id);
  tasks.deleteTask(archived.id);
  const service = backupService();
  expect(service.createBackup(path.join(root, 'tasks/backups')).ok).toBe(false);
  const backup = service.createBackup();
  expect(backup.ok).toBe(true);
  const zip = new AdmZip(backup.backupPath);
  expect(zip.getEntry('tasks/_index.yaml')).toBeNull();
  expect(zip.readAsText(`tasks/${task.id}/attachments/_index.yaml`)).toBe('添付インデックス');
  tasks.updateTaskContent(task.id, '変更');
  attachments.remove(task.id, 'a.txt');
  const restored = await service.restoreBackup(backup.backupPath);
  expect(restored.ok).toBe(true);
  expect(attachments.list(task.id).files).toHaveLength(2);
  expect(fs.readFileSync(attachments.file(task.id, '_index.yaml'), 'utf8')).toBe('添付インデックス');
  expect(attachments.list(task.id).removed).toHaveLength(1);
  expect(fs.existsSync(path.join(root, 'archive', archived.id, 'attachments.zip'))).toBe(true);
});

test('legacy ZIP and empty tasks directory remain restorable', async () => {
  const zip = new AdmZip();
  zip.addFile('tasks/T-0099.md', Buffer.from('---\nid: T-0099\ntitle: 旧バックアップ\nstatus: todo\ndelete_flag: 0\n---\n旧本文'));
  const file = path.join(sandbox, 'legacy.zip');
  zip.writeZip(file);
  const service = backupService();
  expect((await service.restoreBackup(file)).ok).toBe(true);
  expect(tasks.getTaskById('T-0099').title).toBe('旧バックアップ');
  expect(tasks.getTaskFilePath('T-0099')).toBe(path.join(root, 'tasks/T-0099.md'));
  tasks.deleteTask('T-0099');
  const empty = service.createBackup();
  expect((await service.restoreBackup(empty.backupPath)).ok).toBe(true);
  expect(tasks.getAllTasks()).toHaveLength(0);
});


test('image saving and reading preserve bundles and reject unsafe references', () => {
  const task = tasks.addTask({ title: '??' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const first = attachments.saveImage(task.id, png);
  const second = attachments.saveImage(task.id, png);
  expect(first.name).not.toBe(second.name);
  expect(first.name).toMatch(/^clip-image_\d{8}_\d{6}_[0-9a-f]{12}\.png$/);
  expect(first.relativePath).toBe(`attachments/${first.name}`);
  expect(attachments.readImage(task.id, first.relativePath).url).toBe(`data:image/png;base64,${png.toString('base64')}`);
  attachments.add(task.id, [source('日本語 画像.png', png)]);
  expect(attachments.readImage(task.id, 'attachments/' + encodeURIComponent('日本語 画像.png')).preview_type).toBe('image');
  for (const ref of ['../settings.yaml', '%2e%2e/settings.yaml', 'C:/outside.png', 'attachments/missing.png']) expect(() => attachments.readImage(task.id, ref)).toThrow();
  expect(() => attachments.saveImage(task.id, Buffer.alloc(0))).toThrow();
  tasks.updateTaskContent(task.id, `![??](<${first.relativePath}>)`);
  const duplicate = tasks.duplicateTask(task.id);
  expect(attachments.readImage(duplicate.id, first.relativePath).url).toContain('data:image/png');
  attachments.remove(task.id, first.name);
  expect(() => attachments.readImage(task.id, first.relativePath)).toThrow();
});
