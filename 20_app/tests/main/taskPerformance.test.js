const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('js-yaml');
const context = require('../../src/main/projectContext');
const tasks = require('../../src/main/taskService');
const index = require('../../src/main/indexService');
const hierarchy = require('../../src/main/taskHierarchy');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-task-perf-'));
  fs.mkdirSync(path.join(root, 'tasks'));
  fs.writeFileSync(path.join(root, 'settings.yaml'), '{}');
  context.setCurrent(root, { projectId: root, name: 'test' });
});
afterEach(() => { vi.restoreAllMocks(); context.clear(); fs.rmSync(root, { recursive: true, force: true }); });
function write(id, parent = null, extra = {}) {
  const file = path.join(root, 'tasks', `${id}.md`);
  fs.writeFileSync(file, `---\n${YAML.dump({ id, title: id, parent, status: 'todo', progress_status: '未着', delete_flag: 0, ...extra })}---\n`);
  return file;
}

test('幅広5,000件の子孫探索はキャッシュを1回だけ集約する', () => {
  const cache = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`T-${i}`, { id: `T-${i}`, parent: i ? 'T-0' : null, delete_flag: 0 }]));
  const values = vi.spyOn(Object, 'values');
  const result = hierarchy.collectDescendantTasks(cache, 'T-0');
  expect(result).toHaveLength(4999);
  expect(values).toHaveBeenCalledTimes(1);
});

test('変更なしindexでYAML処理を省き、外部の破損と削除は修復する', () => {
  const rows = [{ id: 'T-0001', title: 'one', delete_flag: 0, status: 'todo' }];
  index.rebuildIndex(rows);
  const dump = vi.spyOn(YAML, 'dump');
  expect(index.rebuildIndex(rows).skipped).toBe(true);
  expect(dump).not.toHaveBeenCalled();
  const file = path.join(root, 'tasks/_index.yaml');
  fs.writeFileSync(file, 'tasks: [broken');
  expect(index.rebuildIndex(rows).skipped).not.toBe(true);
  expect(YAML.load(fs.readFileSync(file, 'utf8')).tasks[0].title).toBe('one');
  fs.unlinkSync(file);
  expect(index.rebuildIndex(rows).success).toBe(true);
  rows[0].title = 'changed'; index.rebuildIndex(rows);
  expect(YAML.load(fs.readFileSync(file, 'utf8')).tasks[0].title).toBe('changed');
});

test('ファイルのID変更・重複・unlinkと採番がパス索引後も整合する', async () => {
  const file = write('T-0001'); await tasks.openTaskService();
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('id: T-0001', 'id: T-0999'));
  tasks.applyFileChange('change', file);
  expect(tasks.getAllTasks().map(t => t.id)).toEqual(['T-0999']);
  const duplicate = write('T-0999'); tasks.applyFileChange('add', duplicate);
  expect(tasks.getAllTasks().some(t => t.is_invalid)).toBe(true);
  fs.unlinkSync(duplicate); tasks.applyFileChange('unlink', duplicate);
  expect(tasks.getAllTasks().map(t => t.id)).toEqual(['T-0999']);
  expect(tasks.addTask({ title: 'next' }).id).toBe('T-1000');
});

test('外部編集の親進捗推定をMainで行い、通常の読取りでは書き込まない', async () => {
  write('T-0001'); const child = write('T-0002', 'T-0001'); await tasks.openTaskService();
  fs.writeFileSync(child, fs.readFileSync(child, 'utf8').replace('progress_status: 未着', 'progress_status: 仕掛'));
  tasks.applyFileChange('change', child);
  expect(tasks.getTaskById('T-0001').progress_status).toBe('仕掛');
  const writeSpy = vi.spyOn(fs, 'writeFileSync'); tasks.getAllTasks();
  expect(writeSpy).not.toHaveBeenCalled();
});

test('並び替えの重複・未知ID・省略IDを既存順序で処理し、破損と削除の正本を保持する', async () => {
  const files = [1, 2, 3].map(i => write(`T-000${i}`, null, { sort_order: i }));
  const deleted = write('T-0004', null, { delete_flag: 1, sort_order: 4 });
  const broken = path.join(root, 'tasks', 'broken.md');
  fs.writeFileSync(broken, '---\nid: [broken\n---\n');
  await tasks.openTaskService();
  const preserved = [deleted, broken].map(f => fs.readFileSync(f, 'utf8'));
  const spy = vi.spyOn(fs, 'writeFileSync');
  const payload = { ordered_ids: ['unknown', 'T-0003', 'T-0003'] };
  expect(tasks.reorderTasks(payload).updated_count).toBe(3);
  expect(spy).toHaveBeenCalledTimes(3);
  expect([deleted, broken].map(f => fs.readFileSync(f, 'utf8'))).toEqual(preserved);
  for (const [i, id] of ['T-0003', 'T-0001', 'T-0002'].entries()) {
    const file = files[Number(id.slice(-1)) - 1];
    const disk = YAML.load(fs.readFileSync(file, 'utf8').split('---')[1]);
    expect(disk.sort_order).toBe(i + 1);
    expect(tasks.getTaskById(id).sort_order).toBe(disk.sort_order);
  }
  spy.mockClear();
  expect(tasks.reorderTasks(payload).updated_count).toBe(0);
  expect(spy).not.toHaveBeenCalled();
  tasks.rebuildCache();
  expect(tasks.getAllTasks().filter(t => !t.is_invalid).sort((a, b) => a.sort_order - b.sort_order).map(t => t.id))
    .toEqual(['T-0003', 'T-0001', 'T-0002']);
});

test('一括外部更新後のroots・採番を確定し、破損からの復旧と再読込で正本に一致する', async () => {
  write('T-0001'); await tasks.openTaskService();
  const folder = path.join(root, 'tasks', 'nested');
  fs.mkdirSync(folder);
  const file = path.join(folder, 'T-0900.md');
  fs.writeFileSync(file, '---\nid: T-0900\ntitle: external\ndelete_flag: 0\n---\n');
  expect(tasks.applyFileChange('add', file).success).toBe(true);
  fs.writeFileSync(file, '---\nid: [broken\n---\n');
  tasks.applyFileChange('change', file);
  expect(tasks.getTaskById('T-0900')).toBeNull();
  expect(tasks.getAllTasks().filter(t => t.is_invalid)).toHaveLength(1);
  fs.writeFileSync(file, '---\nid: T-0999\ntitle: recovered\ndelete_flag: 0\n---\n');
  tasks.applyFileChange('change', file);
  expect(tasks.getAllTasks().some(t => t.is_invalid)).toBe(false);
  expect(tasks.getTaskFileRoots()).toContain('nested');
  expect(tasks.addTask({ title: 'next after batch' }).id).toBe('T-1000');
  const before = tasks.getAllTasks().map(t => [t.id, t.title]);
  tasks.rebuildCache();
  expect(tasks.getAllTasks().map(t => [t.id, t.title]).sort()).toEqual(before.sort());
  fs.unlinkSync(file); tasks.applyFileChange('unlink', file);
  expect(tasks.getTaskById('T-0999')).toBeNull();
  expect(tasks.getTaskFileRoots()).not.toContain('nested');
});
