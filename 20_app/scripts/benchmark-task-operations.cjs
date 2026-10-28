// T-0834: generated fixtures only; run with the project's supported Node runtime.
// JSON is written to stdout. Timings are observations, not pass/fail thresholds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const YAML = require('js-yaml');
const matter = require('gray-matter');
const context = require('../src/main/projectContext');
const tasks = require('../src/main/taskService');
const hierarchy = require('../src/main/taskHierarchy');

function measure(fn) {
  const originalValues = Object.values;
  const originalWrite = fs.writeFileSync;
  let valuesCalls = 0, valuesEntries = 0, writes = 0;
  Object.values = function (obj) {
    const rows = originalValues(obj);
    valuesCalls++; valuesEntries += rows.length;
    return rows;
  };
  fs.writeFileSync = function (...args) { writes++; return originalWrite.apply(this, args); };
  try {
    const start = performance.now();
    const result = fn();
    return { result, ms: performance.now() - start, valuesCalls, valuesEntries, writes };
  } finally { Object.values = originalValues; fs.writeFileSync = originalWrite; }
}

function median(fn) {
  fn();
  const times = Array.from({ length: 7 }, () => {
    const start = performance.now(); fn(); return performance.now() - start;
  }).sort((a, b) => a - b);
  return times[3];
}

async function benchmark(n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-t0834-bench-'));
  try {
    const dir = path.join(root, 'tasks');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(root, 'settings.yaml'), '{}');
    context.setCurrent(root, { projectId: root, name: 'isolated T-0834 benchmark' });
    const rows = Array.from({ length: n }, (_, i) => ({
      id: `T-${String(i + 1).padStart(4, '0')}`, title: `Generated ${i}`,
      status: 'todo', progress_status: '未着', delete_flag: 0, parent: null,
      sort_order: i + 1, tags: [], list: null, due_date: null,
    }));
    const cache = Object.fromEntries(rows.map((t, i) => [t.id, { ...t, parent: i ? rows[0].id : null }]));
    const exploration = measure(() => hierarchy.collectDescendantTasks(cache, rows[0].id));
    assert.deepEqual(exploration.result.map(t => t.id), rows.slice(1).map(t => t.id));
    assert.equal(exploration.valuesCalls, 1);
    assert.equal(exploration.valuesEntries, n);
    const descendantCount = exploration.result.length;
    delete exploration.result;
    exploration.medianMs = median(() => hierarchy.collectDescendantTasks(cache, rows[0].id));

    for (const row of rows) fs.writeFileSync(path.join(dir, `${row.id}.md`), `---\n${YAML.dump(row)}---\nfixture\n`);
    await tasks.openTaskService();
    // Root tasks isolate path indexing from the separate parent-state estimation.
    const changes = measure(() => {
      for (const row of rows.slice(0, 10)) assert.equal(tasks.applyFileChange('change', path.join(dir, `${row.id}.md`)).success, true);
    });
    assert.equal(changes.valuesCalls, 0);
    assert.equal(changes.writes, 0);
    const batchFlush = measure(() => tasks.getTaskFileRoots());
    assert.deepEqual(batchFlush.result, ['.']);
    delete batchFlush.result;
    const cleanFlush = measure(() => tasks.getTaskFileRoots());
    assert.equal(cleanFlush.valuesCalls, 0);
    delete cleanFlush.result;
    const ids = rows.map(t => t.id);
    ids.unshift(ids.pop());
    const reorder = measure(() => tasks.reorderTasks({ ordered_ids: ids }));
    assert.equal(reorder.result.updated_count, n);
    assert.equal(reorder.writes, n);
    const unchangedReorder = measure(() => tasks.reorderTasks({ ordered_ids: ids }));
    assert.equal(unchangedReorder.writes, 0);
    assert.equal(unchangedReorder.result.updated_count, 0);
    // Re-read every source file, then rebuild the service cache from disk.
    for (const [i, id] of ids.entries()) {
      const disk = matter(fs.readFileSync(path.join(dir, `${id}.md`), 'utf8')).data;
      assert.equal(disk.sort_order, i + 1);
      assert.equal(tasks.getTaskById(id).sort_order, disk.sort_order);
    }
    assert.equal(tasks.rebuildCache().success, true);
    assert.deepEqual(tasks.getAllTasks().sort((a, b) => a.sort_order - b.sort_order).map(t => t.id), ids);
    return { n, descendantCount, exploration, changes, batchFlush, cleanFlush, reorder, unchangedReorder, diskOrderMatches: true };
  } finally {
    context.clear();
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('cotaska-t0834-bench-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

(async () => {
  const log = console.log;
  console.log = () => {};
  try {
    const measurements = [];
    for (const n of [100, 1000, 5000]) measurements.push(await benchmark(n));
    log(JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
      note: 'exploration: 2 levels; service: roots only; values counts exclude Object.keys and filesystem calls; service timings are single instrumented runs', measurements }, null, 2));
  } finally { console.log = log; }
})().catch(error => { console.error(error); process.exitCode = 1; });
