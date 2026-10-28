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
