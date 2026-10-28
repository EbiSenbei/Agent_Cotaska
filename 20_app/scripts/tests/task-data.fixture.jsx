import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DetailPane from '../../src/renderer/components/DetailPane';
import MainPane from '../../src/renderer/components/MainPane';
import App from '../../src/renderer/App';
import AiChatMessage from '../../src/renderer/components/AiChatMessage';
import '../../src/renderer/App.css';
import '../../src/renderer/styles/app-components.css';

const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const writes = [];
let data = { id: 'T-0001', title: 'before', content: 'original', status: 'todo', progressStatus: '未着', priority: 'normal', tags: [], parent: null };
let setDisplayed;
window.cotaskaAPI = {
  settings: { get: async () => ({ settings: { detailTextSize: 14 } }), update: async () => ({ ok: true }) },
  tasks: { update: async (patch) => { writes.push(patch); data = { ...data, ...patch }; return { success: true }; } },
  attachments: { list: async () => ({ ok: true, result: { files: [], removed: [] } }), onChanged: () => () => {} },
};
function Detail() {
  const [task, setTask] = useState(data); setDisplayed = setTask;
  return <DetailPane key={task.id} projectId="project-a" task={task} tasks={[task]} onSaved={() => setTask({ ...data })} />;
}
function input(element, value) {
  Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
const root = createRoot(document.getElementById('root'));
(async () => {
  root.render(<Detail />); await pause(100);
  input(document.querySelector('.header-title'), 'edited title'); await pause(50);
  const priority = [...document.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'high'));
  check(priority, 'priority select missing'); priority.value = 'high'; priority.dispatchEvent(new Event('change', { bubbles: true }));
  await pause(650);
  check(data.title === 'edited title' && data.priority === 'high', 'delayed save overwrote title/priority');
  check(writes.every(patch => !Object.hasOwn(patch, 'content')), 'metadata saved unrelated content');
  data = { ...data, content: 'externally edited' }; setDisplayed({ ...data }); await pause();
  check(document.querySelector('textarea').value === 'externally edited', 'clean draft did not accept external edit');
  input(document.querySelector('textarea'), 'local unsaved'); await pause();
  setDisplayed({ ...data, priority: 'medium' }); await pause();
  check(document.querySelector('textarea').value === 'local unsaved', 'external snapshot erased dirty draft');
  setDisplayed({ ...data, id: 'T-0002', title: 'next' }); await pause(100);
  check(writes.some(patch => patch.id === 'T-0001' && patch.content === 'local unsaved'), 'unmount lost pending edit');

  const renderTimings = [];
  const style = document.createElement('style');
  style.textContent = '.main-pane { height: 600px; width: 900px; }';
  document.head.append(style);
  for (const count of [1000, 5000]) {
    // Counting title reads shows that offscreen rows were not converted to JSX.
    let titleReads = 0;
    const tasks = Array.from({ length: count }, (_, i) => ({ ...data, id: `T-${i + 1}`, parent: null, get title() { titleReads++; return `task ${i}`; } }));
    const start = performance.now();
    root.render(<MainPane key={count} viewTitle="検証" tasks={tasks} lists={[]} onTaskClick={() => {}} />);
    await pause(100);
    const mountedRows = document.querySelectorAll('.task-row').length;
    check(mountedRows < 100, 'virtual list mounted all rows');
    check(titleReads < 300, 'virtual list generated offscreen JSX');
    const list = document.querySelector('.task-list');
    list.scrollTop = 12000; list.dispatchEvent(new Event('scroll', { bubbles: true })); await pause(60);
    check(document.querySelectorAll('.task-row').length > 0, 'scroll produced empty list');
    renderTimings.push({ count, mountedRows, titleReads, elapsedWithWaitMs: Math.round(performance.now() - start) });
  }
  const historyChecks = [];
  for (const count of [500, 2000]) {
    let bodyReads = 0;
    const messages = Array.from({ length: count }, (_, id) => ({ id, author: 'AI', role: 'assistant', get body() { bodyReads++; return 'Synthetic history **unchanged**'; } }));
    const copy = () => {};
    const history = tick => <section key={count} data-tick={tick}>{messages.map(message => <AiChatMessage key={message.id} message={message} onCopy={copy} />)}</section>;
    root.render(history(0)); await pause(150);
    const initialReads = bodyReads;
    root.render(history(1)); await pause(100);
    check(initialReads === count && bodyReads === initialReads, 'unchanged history rerendered on parent update');
    historyChecks.push({ count, initialReads, extraBodyReadsAfterParentUpdate: bodyReads - initialReads });
  }
  let onChanged;
  let onProjectChanged;
  const raw = title => ({ id: 'T-0900', title, content: '', status: 'todo', progress_status: '未着', delete_flag: 0, parent: null, tags: [] });
  window.cotaskaAPI.settings.get = async () => ({ settings: { onboarding: { completed: true }, startup: { initialView: 'すべて' } } });
  window.cotaskaAPI.projects = { getCurrent: async () => ({ projectId: 'a', name: 'A' }), onChanged: callback => { onProjectChanged = callback; return () => {}; }, listRecent: async () => [] };
  window.cotaskaAPI.lists = { getAll: async () => [] };
  window.cotaskaAPI.tags = { getAll: async () => [] };
  window.cotaskaAPI.tasks.getAll = async () => [raw('initial row')];
  window.cotaskaAPI.tasks.getCompletedPage = async () => ({ tasks: [], hasMore: false });
  window.cotaskaAPI.onTasksChanged = callback => { onChanged = callback; return () => {}; };
  root.render(<App />); await pause(180);
  check(document.body.textContent.includes('initial row'), 'App bootstrap failed');
  const reads = [];
  window.cotaskaAPI.tasks.getAll = () => new Promise(resolve => reads.push(resolve));
  onChanged({}); onChanged({}); await pause();
  // A newer request may make the first stale before it reaches getAll. Trigger
  // each only after the prior read is waiting to force two in-flight snapshots.
  if (reads.length < 2) { onChanged({}); await pause(); }
  check(reads.length === 2, 'failed to stage reverse IPC reads');
  reads[1]([raw('newest row')]); await pause();
  reads[0]([raw('outdated row')]); await pause();
  check(document.body.textContent.includes('newest row') && !document.body.textContent.includes('outdated row'), 'App accepted stale response');
  window.cotaskaAPI.tasks.getAll = async () => [raw('project B row')];
  await onProjectChanged({ projectId: 'b', name: 'B' }); await pause(80);
  check(document.body.textContent.includes('project B row') && !document.body.textContent.includes('newest row'), 'project view did not reset');
  root.unmount();
  window.parallelResult = { ok: true, checks: ['patch save', 'external update', 'dirty draft', 'unmount flush', 'virtual JSX', 'scroll', 'memo history', 'App bootstrap', 'reverse IPC', 'project view reset'], writes: writes.length, renderTimings, historyChecks };
})().catch(error => { window.parallelResult = { ok: false, error: error.stack }; });
