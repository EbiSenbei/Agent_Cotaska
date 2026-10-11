const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrate } = require('./migrate-task-folders.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-migration-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project');
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  return { root, backupDir: path.join(dir, 'backups'), apply: true, appStopped: true, compatibleApp: true };
}
function task(options, relative, id) {
  const file = path.join(options.root, 'tasks', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\r\nid: ${id}\r\nstatus: todo\r\n---\r\n日本語本文\r\n`);
  return file;
}

test('dry-run preserves files; apply verifies backup, nested tasks and rerun', (t) => {
  const options = fixture(t);
  const old = task(options, 'T-0001.md', 'T-0001');
  task(options, 'sub/T-0002.md', 'T-0002');
  task(options, 'T-0003/T-0003.md', 'T-0003');
  const content = fs.readFileSync(old);
  fs.mkdirSync(path.join(options.root, 'tasks/T-0003/attachments'));
  fs.writeFileSync(path.join(options.root, 'tasks/T-0003/attachments/reference.md'), '資料');
  fs.writeFileSync(path.join(options.root, 'tasks/_index.yaml'), 'unchanged');
  const dry = migrate({ root: options.root });
  assert.equal(dry.pending, 2);
  assert.ok(fs.existsSync(old));
  assert.equal(fs.existsSync(options.backupDir), false);
  const result = migrate(options);
  assert.equal(result.moved, 2);
  assert.deepEqual(fs.readFileSync(path.join(options.root, 'tasks/T-0001/T-0001.md')), content);
  assert.deepEqual(fs.readFileSync(path.join(result.runDir, 'snapshot/tasks/T-0001.md')), content);
  assert.ok(fs.existsSync(path.join(options.root, 'tasks/sub/T-0002/T-0002.md')));
  assert.equal(fs.readFileSync(path.join(options.root, 'tasks/_index.yaml'), 'utf8'), 'unchanged');
  assert.equal(migrate(options).mode, 'already-migrated');
});

test('duplicate IDs stop before any migration', (t) => {
  const options = fixture(t);
  const old = task(options, 'T-0001.md', 'T-0001');
  task(options, 'sub/T-0001.md', 'T-0001');
  assert.throws(() => migrate(options), /ID重複/);
  assert.ok(fs.existsSync(old));
  assert.equal(fs.existsSync(options.backupDir), false);
});

test('ID mismatch, destination collision, internal backup and missing flags stop', (t) => {
  const options = fixture(t);
  const old = task(options, 'T-0001.md', 'T-9999');
  assert.throws(() => migrate(options), /IDが一致/);
  task(options, 'T-0001.md', 'T-0001');
  fs.mkdirSync(path.join(options.root, 'tasks/T-0001'));
  assert.throws(() => migrate(options), /既にあります/);
  fs.rmdirSync(path.join(options.root, 'tasks/T-0001'));
  assert.throws(() => migrate({ ...options, backupDir: path.join(options.root, 'backup') }), /外に指定/);
  assert.equal(fs.existsSync(path.join(options.root, 'backup')), false);
  assert.throws(() => migrate({ ...options, appStopped: false }), /app-stopped/);
  assert.ok(fs.existsSync(old));
});
