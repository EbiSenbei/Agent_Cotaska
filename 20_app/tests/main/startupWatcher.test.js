const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const context = require('../../src/main/projectContext');
const tasks = require('../../src/main/taskService');
const indexService = require('../../src/main/indexService');
const YAML = require('js-yaml');

let roots = [];
let instances = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-startup-watch-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'tasks'));
  fs.writeFileSync(path.join(root, 'settings.yaml'), '{}');
  context.setCurrent(root, { projectId: root, schemaVersion: 1, name: 'startup-test' });
  return root;
}
function writeTask(root, id, title, relative = `${id}/${id}.md`, extra = {}) {
  const file = path.join(root, 'tasks', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\n' + YAML.dump({ id, title, status: 'todo', progress_status: '未着', delete_flag: 0, sort_order: 1, parent: null, tags: [], ...extra }) + '---\n');
  return file;
}
function loadWatcher() {
  const emitters = [];
  const messages = [];
  const taskApi = { ...tasks, applyFileChange: vi.fn(tasks.applyFileChange), rebuildCache: vi.fn(tasks.rebuildCache) };
  const indexApi = { rebuildIndex: vi.fn(indexService.rebuildIndex) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/main/watcher.js'), 'utf8'), {
    module, performance, setTimeout, clearTimeout,
    console: { log() {}, error() {} },
    require(id) {
      if (id === 'path') return path;
      if (id === './taskService') return taskApi;
      if (id === './indexService') return indexApi;
      if (id === 'chokidar') return { watch() {
        const emitter = new EventEmitter();
        emitter.close = vi.fn(async () => {});
        emitters.push(emitter);
        return emitter;
      } };
      throw new Error('Unexpected dependency ' + id);
    },
  });
  const api = { ...module.exports, emitters, taskApi, indexApi, messages,
    window: { isDestroyed: () => false, webContents: { send: (...args) => messages.push(args) } } };
  instances.push(api);
  return api;
}
afterEach(async () => {
  for (const instance of instances) await instance.stopWatcher();
  instances = [];
  context.clear();
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('cotaska-startup-watch-')) throw new Error('Unsafe test cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  roots = [];
});

test('初期addを個別適用せず起動途中の編集・追加・削除を正本から一括反映する', async () => {
  const root = project();
  const first = writeTask(root, 'T-0001', 'before');
  const removed = writeTask(root, 'T-0002', 'removed');
  await tasks.openTaskService();
  writeTask(root, 'T-0001', 'during startup');
  fs.unlinkSync(removed);
  writeTask(root, 'T-0003', 'new nested task', 'sub/T-0003.md');
  writeTask(root, 'T-0004', 'trashed', undefined, { delete_flag: 1 });
  const watcher = loadWatcher();
  const starting = watcher.startWatcher(watcher.window);
  let resolved = false;
  starting.then(() => { resolved = true; });
  const emitter = watcher.emitters[0];
  for (let i = 0; i < 797; i++) emitter.emit('add', first);
  emitter.emit('change', first);
  emitter.emit('unlink', removed);
  await Promise.resolve();
  expect(resolved).toBe(false);
  expect(watcher.taskApi.applyFileChange).not.toHaveBeenCalled();
  expect(watcher.messages).toHaveLength(0);
  emitter.emit('ready');
  await expect(starting).resolves.toMatchObject({ success: true });
  expect(watcher.taskApi.rebuildCache).toHaveBeenCalledTimes(1);
  expect(watcher.indexApi.rebuildIndex).toHaveBeenCalledTimes(1);
  expect(tasks.getAllTasks().map(t => t.title).sort()).toEqual(['during startup', 'new nested task']);
  expect(tasks.getCache()['T-0002']).toBeUndefined();
  expect(watcher.messages).toHaveLength(1);
  expect(watcher.messages[0][1].tasks.map(t => t.title).sort()).toEqual(['during startup', 'new nested task']);
  const index = YAML.load(fs.readFileSync(path.join(root, 'tasks/_index.yaml'), 'utf8'));
  expect(index.tasks.map(t => t.id).sort()).toEqual(['T-0001', 'T-0003']);
});

test('起動照合で破損・ID変更・重複を検出しready後の通常編集も反映する', async () => {
  const root = project();
  writeTask(root, 'T-0001', 'before');
  await tasks.openTaskService();
  writeTask(root, 'T-0002', 'ID changed', 'T-0001/T-0001.md');
  writeTask(root, 'T-0002', 'duplicate', 'duplicate/T-0002.md');
  const broken = path.join(root, 'tasks/broken.md');
  fs.writeFileSync(broken, '---\nid: [\n---\n');
  const watcher = loadWatcher();
  const starting = watcher.startWatcher(watcher.window);
  watcher.emitters[0].emit('ready');
  await starting;
  expect(tasks.getCache()['T-0001']).toBeUndefined();
  const invalid = tasks.getAllTasks().filter(t => t.is_invalid);
  expect(invalid).toHaveLength(2);
  expect(invalid.some(t => t.validation_error.includes('重複'))).toBe(true);
  expect(invalid.some(t => t.validation_file_path.endsWith('broken.md'))).toBe(true);
  writeTask(root, 'T-0003', 'after ready');
  watcher.emitters[0].emit('add', path.join(root, 'tasks/T-0003/T-0003.md'));
  watcher.emitters[0].emit('unlink', broken);
  fs.unlinkSync(broken);
  expect(tasks.getAllTasks().some(t => t.title === 'after ready')).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(watcher.messages.at(-1)[1].tasks.some(t => t.title === 'after ready')).toBe(true);
  expect(watcher.messages.at(-1)[1].tasks.some(t => t.validation_file_path?.endsWith('broken.md'))).toBe(false);
  expect(watcher.taskApi.applyFileChange).toHaveBeenCalledTimes(2);
});

test('準備中の停止で待機を解除し旧監視のready・変更を新プロジェクトへ適用しない', async () => {
  project();
  await tasks.openTaskService();
  const watcher = loadWatcher();
  const oldStart = watcher.startWatcher(watcher.window);
  const old = watcher.emitters[0];
  await watcher.stopWatcher();
  await expect(oldStart).resolves.toMatchObject({ success: false, cancelled: true });
  const next = project();
  const file = writeTask(next, 'T-0001', 'next project');
  await tasks.openTaskService();
  const nextStart = watcher.startWatcher(watcher.window);
  old.emit('ready');
  old.emit('change', file);
  expect(watcher.taskApi.rebuildCache).not.toHaveBeenCalled();
  expect(watcher.taskApi.applyFileChange).not.toHaveBeenCalled();
  watcher.emitters[1].emit('ready');
  await expect(nextStart).resolves.toMatchObject({ success: true });
  expect(watcher.taskApi.rebuildCache).toHaveBeenCalledTimes(1);
  expect(watcher.messages).toHaveLength(1);
  expect(watcher.messages[0][1].tasks[0].title).toBe('next project');
});

test.each(['cache', 'index', 'watcher'])('%sの初期化失敗を成功にせず監視を解放する', async failure => {
  project();
  await tasks.openTaskService();
  const watcher = loadWatcher();
  if (failure === 'cache') watcher.taskApi.rebuildCache.mockReturnValue({ success: false, error: 'cache failed' });
  if (failure === 'index') watcher.indexApi.rebuildIndex.mockReturnValue({ success: false, error: 'index failed' });
  const starting = watcher.startWatcher(watcher.window);
  const emitter = watcher.emitters[0];
  emitter.emit(failure === 'watcher' ? 'error' : 'ready', new Error('watch failed'));
  if (failure === 'watcher') emitter.emit('ready');
  await expect(starting).resolves.toMatchObject({ success: false });
  expect(emitter.close).toHaveBeenCalledTimes(1);
  expect(watcher.messages).toHaveLength(0);
  if (failure === 'watcher') expect(watcher.taskApi.rebuildCache).not.toHaveBeenCalled();
});

test('準備完了後の停止で保留通知を確定し古いタイマーやイベントを次の監視へ残さない', async () => {
  const oldRoot = project();
  const file = writeTask(oldRoot, 'T-0001', 'old project');
  await tasks.openTaskService();
  const watcher = loadWatcher();
  const oldStart = watcher.startWatcher(watcher.window);
  const old = watcher.emitters[0];
  old.emit('ready');
  await oldStart;
  writeTask(oldRoot, 'T-0001', 'last old edit');
  old.emit('change', file);
  await watcher.stopWatcher();
  expect(watcher.messages.at(-1)[1].tasks[0].title).toBe('last old edit');
  watcher.messages.length = 0;
  const nextRoot = project();
  writeTask(nextRoot, 'T-0002', 'new project');
  await tasks.openTaskService();
  const nextStart = watcher.startWatcher(watcher.window);
  watcher.emitters[1].emit('ready');
  await nextStart;
  old.emit('change', file);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(watcher.messages).toHaveLength(1);
  expect(watcher.messages[0][1].tasks.map(t => t.title)).toEqual(['new project']);
  expect(watcher.taskApi.applyFileChange).toHaveBeenCalledTimes(1);
});
