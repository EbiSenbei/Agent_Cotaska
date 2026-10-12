const fs = require('fs');
const os = require('os');
const path = require('path');
const context = require('./projectContext');
const tasks = require('./taskService');

test('非引用YAML期限を文字列に正規化し、元ファイルを維持する', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-dates-'));
  try {
    context.setCurrent(root, { projectId: 'date-test', schemaVersion: 1, name: 'test' });
    fs.mkdirSync(path.join(root, 'tasks'));
    const file = path.join(root, 'tasks', 'T-0001.md');
    const original = '---\nid: T-0001\ntitle: 設計反映\nstatus: todo\ndue_date: 2026-10-11T00:00:00.000Z\ndeadline_date: 2026-10-12\n---\n本文';
    fs.writeFileSync(file, original);
    await tasks.openTaskService();
    const task = tasks.getTaskById('T-0001');
    expect(task.due_date).toBe('2026-10-11');
    expect(task.deadline_date).toBe('2026-10-12');
    expect(task.title).toBe('設計反映');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  } finally {
    context.clear();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
