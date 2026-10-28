import React, { Profiler } from "react";
import { createRoot } from "react-dom/client";
import AiChatPane from "../../src/renderer/components/AiChatPane";

const baseline = window.workdirBaseline;
const pending = [];
let pathReads = 0;
let hiddenPathReads = 0;
const rows = [{ id: "folder", file_path: "folder", label: "folder", type: "directory", level: 0 },
  ...Array.from({ length: 74882 }, (_, i) => ({
    id: `file-${i}`, label: `file-${i}.txt`, type: "file", level: 1,
    get file_path() { pathReads++; if (i === 12345) hiddenPathReads++; return `folder\\file-${i}.txt`; },
  }))];
const tree = { ok: true, root: "C:/synthetic", rows, truncated: false };
window.cotaskaAPI = {
  settings: { get: async () => ({ configured: { aiChatWorkdir: true }, settings: { aiChat: { workdir: "C:/synthetic" } } }) },
  aiChat: {
    getDbInfo: async () => ({ ok: true }),
    listThreads: async () => [{ thread_id: "a", title: "Thread a" }],
    listActiveRuns: async () => [], setActiveThread: async () => {},
    listMessages: async () => Array.from({ length: 500 }, (_, i) => ({ message_id: `m-${i}`, role: "user", content: `history-${i}` })),
    listReferences: async () => [],
    listWorkdirTree: () => new Promise(resolve => pending.push(resolve)),
  },
};
const delay = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, label) => { if (!value) throw new Error(label); };
async function wait(check, label) {
  for (let i = 0; i < 250; i++) { if (check()) return; await delay(); }
  throw new Error(`Timeout: ${label}`);
}
function input(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
function tab(name) { [...document.querySelectorAll('[role="tablist"] button')].find(button => button.textContent === name).click(); }
let root;
const commits = [];
function mount() {
  root = createRoot(document.getElementById("root"));
  root.render(<Profiler id="chat" onRender={(_id, _phase, duration) => commits.push(duration)}><AiChatPane /></Profiler>);
}
const samples = [];
async function typeSample(name) {
  const before = pathReads, hiddenBefore = hiddenPathReads, from = commits.length;
  for (let i = 0; i < 5; i++) {
    input(document.querySelector("textarea"), `${name}-${i} 日本語入力`);
    await delay();
  }
  samples.push({ name, pathReads: pathReads - before, hiddenPathReads: hiddenPathReads - hiddenBefore, maxCommitMs: Math.max(0, ...commits.slice(from)), totalCommitMs: commits.slice(from).reduce((a, b) => a + b, 0) });
  // Visible rows legitimately read their paths while rendering. A hidden row
  // must not be revisited just because the draft changed.
  if (!baseline) assert(hiddenPathReads === hiddenBefore, `${name}: draft rescanned the tree`);
}

(async () => {
  const checks = [];
  mount();
  if (baseline) {
    await wait(() => pending.length === 1, "baseline eager tree request");
    await delay(100);
    assert(!document.body.textContent.includes("history-499"), "baseline should wait for tree before history");
    pending[0](tree);
  }
  await wait(() => document.body.textContent.includes("history-499"), "saved history");
  const initialRequests = pending.length;
  if (!baseline) assert(initialRequests === 0, "opening chat requested a tree");
  checks.push(baseline ? "before: conversation waits for folder I/O" : "conversation opens independently of folder I/O");
  await typeSample("threads");
  tab("フォルダ");
  if (!baseline) {
    await wait(() => pending.length === 1, "lazy folder request");
    await typeSample("loading");
    pending[0](tree);
  }
  await wait(() => document.querySelector('.ai-file-name')?.textContent === "folder", "root folder");
  assert(document.querySelectorAll('.ai-file-name').length === 1, "collapsed descendants mounted");
  await typeSample("files");
  input(document.querySelector('.ai-search-box input'), "file-74881.txt");
  await wait(() => document.body.textContent.includes("file-74881.txt"), "last file searchable without truncation");
  assert(document.querySelectorAll('.ai-file-name').length === 2, "search must include matching file and ancestor");
  await typeSample("search-results");
  checks.push(baseline ? "before: all rows retained; draft rescans hidden rows" : "all 74883 rows retained, search includes ancestors, draft does not recalculate visibility");
  input(document.querySelector('.ai-search-box input'), "file-0.txt");
  await wait(() => document.querySelectorAll('.ai-file-name').length === 2 && document.body.textContent.includes("file-0.txt"), "search updates");
  input(document.querySelector('.ai-search-box input'), "");
  await wait(() => document.querySelectorAll('.ai-file-name').length === 1, "search cleared");
  // Test expansion with a small refreshed tree, keeping rendering bounded.
  const refresh = () => [...document.querySelectorAll('button')].find(button => button.textContent === "更新").click();
  if (!baseline) {
    refresh(); refresh();
    await wait(() => pending.length === 3, "overlapping refreshes");
    pending[2]({ ...tree, rows: [rows[0], rows[1]] });
    await wait(() => !document.body.textContent.includes("読み込み中"), "new refresh");
    pending[1]({ ...tree, rows: [{ id: "stale", label: "stale", file_path: "stale", type: "file", level: 0 }] });
    await delay(80);
    assert(!document.body.textContent.includes("stale"), "stale response replaced latest tree");
    document.querySelector('.ai-file-name').closest('button').click();
    await wait(() => document.querySelectorAll('.ai-file-name').length === 2, "expanded child");
    document.querySelector('.ai-file-name').closest('button').click();
    await wait(() => document.querySelectorAll('.ai-file-name').length === 1, "collapsed child");
    checks.push("refresh freshness, stale response ignored, expansion and collapse preserved");
    refresh();
    await wait(() => pending.length === 4, "inflight before unmount");
    root.unmount();
    mount();
    await wait(() => document.body.textContent.includes("history-499"), "remounted conversation");
    pending[3]({ ...tree, rows: [{ id: "stale", label: "stale", file_path: "stale", level: 0 }] });
    await delay(50);
    assert(pending.length === 4, "remount eagerly requested a tree");
    tab("フォルダ");
    await wait(() => pending.length === 5, "fresh folder request after remount");
    pending[4]({ ...tree, rows: [rows[0]] });
    await wait(() => document.querySelector('.ai-file-name')?.textContent === "folder", "fresh remount tree");
    checks.push("unmount discards inflight result; remount remains lazy");
  }
  root.unmount();
  window.workdirResult = { ok: true, mode: baseline ? "before" : "after", initialRequests, treeRows: rows.length, samples, checks };
})().catch(error => { window.workdirResult = { ok: false, error: error.stack, samples }; });
