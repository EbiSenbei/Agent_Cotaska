import React, { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import MainPane from '../../src/renderer/components/MainPane';
import DetailPane from '../../src/renderer/components/DetailPane';
import AiChatMessage from '../../src/renderer/components/AiChatMessage';
import '../../src/renderer/App.css';
import '../../src/renderer/styles/app-components.css';

// Synthetic component benchmark. Never opens the application or a real project.
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const noop = () => {};
const root = createRoot(document.getElementById('root'));
const commits = [];
const longTasks = [];
const samples = [];
let titleReads = 0, sortReads = 0, bodyReads = 0;
const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries()));
observer.observe({ type: 'longtask', buffered: false });
const profile = child => <Profiler id="subject" onRender={(_id, phase, actualDuration, baseDuration, startTime, commitTime) => {
  commits.push({ phase, actualDuration, baseDuration, startTime, commitTime });
}}>{child}</Profiler>;
function input(element, value) {
  check(element, 'input missing');
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
const heap = () => performance.memory?.usedJSHeapSize ?? null;
async function measure(name, action) {
  await pause();
  const start = performance.now(), from = commits.length;
  const reads = { titleReads, sortReads, bodyReads };
  let insertedRows = 0, insertedMessages = 0;
  const mounts = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      insertedRows += Number(node.matches('.task-row')) + node.querySelectorAll('.task-row').length;
      insertedMessages += Number(node.matches('.ai-message')) + node.querySelectorAll('.ai-message').length;
    }
  });
  mounts.observe(document.getElementById('root'), { childList: true, subtree: true });
  await action();
  // React may yield its render across tasks. Wait for a quiet interval rather
  // than treating the first timer firing as a completed commit.
  for (let attempts = 0; attempts < 100; attempts++) {
    const previous = commits.length;
    await pause(100);
    if (previous === commits.length) break;
    check(attempts < 99, `render did not settle: ${name}`);
  }
  const end = performance.now();
  mounts.disconnect();
  const batch = commits.slice(from);
  const long = longTasks.filter(task => task.startTime >= start && task.startTime < end);
  samples.push({ name, commitCount: batch.length,
    renderTotalMs: batch.reduce((sum, item) => sum + item.actualDuration, 0),
    renderMaxMs: Math.max(0, ...batch.map(item => item.actualDuration)),
    longTaskCount: long.length, longTaskTotalMs: long.reduce((sum, task) => sum + task.duration, 0),
    insertedRows, insertedMessages, mountedRows: document.querySelectorAll('.task-row').length,
    mountedMessages: document.querySelectorAll('.ai-message').length,
    titleReads: titleReads - reads.titleReads, sortReads: sortReads - reads.sortReads, bodyReads: bodyReads - reads.bodyReads,
    listHeight: document.querySelector('.task-list')?.clientHeight ?? null,
    heapBytes: heap(), elapsedIncludingSettleMs: end - start });
}
const writes = [], reorder = [], previews = [];
let attachmentChanged;
window.cotaskaAPI = {
  settings: { get: async () => ({ settings: { detailTextSize: 14 } }), update: async () => ({ ok: true }) },
  tasks: { update: async patch => { writes.push(patch); return { success: true }; } },
  attachments: { list: async () => ({ ok: true, result: { files: [], removed: [] } }),
    onChanged: callback => { attachmentChanged = callback; return noop; } },
  aiChat: { previewFile: async filePath => {
    previews.push(filePath);
    return { ok: true, preview_type: 'image', url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')}#${previews.length}` };
  } },
};
const style = document.createElement('style');
style.textContent = '.main-pane {height:600px;width:900px;flex:none}.main-pane .task-list {flex:none;height:450px;min-height:0}.ai-history-test {height:500px;overflow:auto}';
document.head.append(style);
const checks = [];
(async () => {
  for (const count of [1000, 5000]) {
    const tasks = Array.from({ length: count }, (_, index) => ({
      id: `T-${String(index + 1).padStart(4, '0')}`, parent: null, content: 'synthetic content',
      status: 'todo', progressStatus: '未着', priority: 'normal', tags: [],
      due_date: '2026-10-28', due: '今日', overdue: false,
      get title() { titleReads++; return `Synthetic task ${index}`; },
      get sort_order() { sortReads++; return count - index; },
    }));
    const main = rows => profile(<MainPane key={`main-${count}`} viewTitle="synthetic" tasks={rows} lists={[]}
      onAddTask={noop} onTaskClick={noop} onReorderTask={payload => reorder.push(payload)} />);
    await measure(`list/${count}/initial`, () => root.render(main(tasks)));
    check(document.querySelectorAll('.task-row').length < 100, 'initial virtualization failed');
    const list = document.querySelector('.task-list');
    for (let index = 1; index <= 5; index++) {
      await measure(`list/${count}/scroll-${index}`, () => {
        list.scrollTop = index * 5000; list.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      check(document.querySelectorAll('.task-row').length > 0, 'empty viewport');
    }
    const scrollTop = list.scrollTop;
    const beforeResize = list.clientHeight;
    await measure(`list/${count}/resize`, () => { list.style.height = '330px'; });
    check(list.clientHeight < beforeResize, 'resize did not change viewport');
    check(samples.at(-1).commitCount > 0, 'ResizeObserver did not update React');
    check(list.scrollTop === scrollTop, 'resize reset scroll');
    await measure(`list/${count}/input`, () => input(document.querySelector('.quick-add input'), 'Synthetic draft'));
    check(list.scrollTop === scrollTop, 'input reset scroll');
    // Simulates the next date-derived task snapshot without resetting the pane.
    const nextDay = tasks.map(task => ({ ...task, overdue: true, due: '昨日' }));
    await measure(`list/${count}/date-snapshot`, () => root.render(main(nextDay)));
    check(document.querySelector('.task-due.overdue') && list.scrollTop === scrollTop, 'date snapshot stale/reset');
    check(document.querySelector('.quick-add input').value === 'Synthetic draft', 'snapshot erased quick-add draft');
    const row = document.querySelector('.task-row');
    const sourceId = row.dataset.taskId;
    const transfer = new DataTransfer();
    await measure(`list/${count}/drag-start`, () => {
      row.querySelector('.drag-handle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    });
    const target = [...document.querySelectorAll('.task-row')].find(element => element.dataset.taskId !== sourceId && element.getBoundingClientRect().top >= list.getBoundingClientRect().top);
    check(target, 'drag target missing');
    const rect = target.getBoundingClientRect();
    await measure(`list/${count}/drag-over`, () => target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 })));
    await measure(`list/${count}/drop`, () => target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 })));
    check(reorder.at(-1)?.draggedTaskId === sourceId && reorder.at(-1)?.targetTaskId === target.dataset.taskId, 'wrong drop payload');
    check(document.querySelectorAll('.task-row').length < 100 && list.scrollTop === scrollTop, 'drop failed to restore viewport');
    checks.push(`list ${count}: scroll, resize, quick-add draft, date-derived snapshot, drag/drop payload`);

    const selected = { ...tasks[0], title: 'selected synthetic task' };
    const detail = task => profile(<DetailPane key={`detail-${count}`} projectId="synthetic" task={task} tasks={tasks} onSaved={noop} />);
    await measure(`detail/${count}/initial`, () => root.render(detail(selected)));
    for (let index = 0; index < 5; index++) await measure(`detail/${count}/input-${index}`, () => input(document.querySelector('textarea'), `unsaved ${index}`));
    await measure(`detail/${count}/external-update`, () => root.render(detail({ ...selected, priority: 'high' })));
    check(document.querySelector('textarea').value === 'unsaved 4', 'external update erased draft');
    attachmentChanged?.({ taskId: selected.id });
    await pause(600);
    check(writes.some(patch => patch.content === 'unsaved 4'), 'draft not saved');
    checks.push(`detail ${count}: external snapshot preserves dirty input, save`);
  }
  for (const count of [500, 2000]) {
    let messages = Array.from({ length: count }, (_, index) => ({ id: index, author: 'AI', role: 'assistant',
      get body() { bodyReads++; return `Synthetic **history** ${index} T-0001 [link](https://example.invalid)`; } }));
    let copied, opened;
    const onCopy = message => { copied = message.id; };
    const onOpenTask = id => { opened = id; };
    const history = tick => profile(<section key={`history-${count}`} className="ai-history-test" data-tick={tick}>
      {messages.map(message => <AiChatMessage key={message.id} message={message} onCopy={onCopy} onOpenTask={onOpenTask} />)}
    </section>);
    await measure(`history/${count}/initial`, () => root.render(history(0)));
    const panel = document.querySelector('.ai-history-test');
    panel.scrollTop = 2000;
    const position = panel.scrollTop;
    for (let index = 1; index <= 5; index++) await measure(`history/${count}/parent-${index}`, () => root.render(history(index)));
    check(panel.scrollTop === position, 'history parent update reset scroll');
    document.querySelector('.ai-message-copy-btn').click();
    document.querySelector('.ai-task-link').click();
    check(copied === 0 && opened === 'T-0001', 'history actions stale');
    messages = messages.map((message, index) => index === 0 ? { ...message, body: 'updated **stream**', attachments: [{ id: 'image', filePath: 'cotaska-image:synthetic/a', label: 'image' }] } : message);
    await measure(`history/${count}/message-update`, () => root.render(history(6)));
    check(document.querySelector('.ai-message-markdown').textContent.includes('updated stream'), 'message update skipped');
    const firstUrl = document.querySelector('.ai-image-thumbnail')?.src;
    messages = messages.map((message, index) => index === 0 ? { ...message, attachments: [{ id: 'image', filePath: 'cotaska-image:synthetic/b', label: 'image' }] } : message);
    await measure(`history/${count}/image-update`, () => root.render(history(7)));
    check(firstUrl && document.querySelector('.ai-image-thumbnail')?.src !== firstUrl && previews.at(-1).endsWith('/b'), 'changed image path stale');
    checks.push(`history ${count}: scroll, copy, task link, message replacement, changed image path`);
  }
  await measure('unmount', () => root.render(null));
  // Also validate the baseline transformations so source drift cannot silently
  // turn an A/B comparison into two identical builds.
  for (const count of [1000, 5000]) {
    const scrolls = samples.filter(sample => sample.name.startsWith(`list/${count}/scroll-`));
    check(scrolls.every(sample => window.renderBaseline ? sample.titleReads >= count : sample.titleReads < 100), 'unexpected list work count');
    const inputs = samples.filter(sample => sample.name.startsWith(`detail/${count}/input-`));
    check(inputs.every(sample => window.renderBaseline ? sample.sortReads > 0 : sample.sortReads === 0), 'unexpected detail sort count');
  }
  for (const count of [500, 2000]) {
    const parents = samples.filter(sample => sample.name.startsWith(`history/${count}/parent-`));
    check(parents.every(sample => sample.bodyReads === (window.renderBaseline ? count : 0)), 'unexpected history body count');
  }
  window.gc?.(); await pause();
  observer.disconnect(); root.unmount();
  window.parallelResult = { ok: true, checks, samples, heapAfterUnmountAndOptionalGc: heap(), gcAvailable: typeof window.gc === 'function',
    notes: ['React development Profiler actualDuration is render work per commit, not DOM commit-phase duration.',
      'elapsedIncludingSettleMs includes fixed waits; do not compare it as render latency.',
      'Inserted nodes are DOM insertions, including reinsertions; mounted counts are live DOM counts.',
      'Heap is whole renderer JS heap with precise-memory-info; per-operation GC is uncontrolled.',
      'Date check injects the next derived snapshot; no wall-clock midnight scheduler is tested.',
      'Image freshness check replaces filePath; same-path file content replacement is not tested.',
      'Drag events are synthetic DOM events; native drag image/autoscroll remains a manual check.'] };
})().catch(error => { observer.disconnect(); window.parallelResult = { ok: false, error: error.stack, samples }; });
