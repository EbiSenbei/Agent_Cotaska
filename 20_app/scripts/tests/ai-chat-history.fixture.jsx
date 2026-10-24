import React from "react";
import { createRoot } from "react-dom/client";
import AiChatPane from "../../src/renderer/components/AiChatPane";

// Exercise real React mount/selection/effect ordering with deferred IPC snapshots.
// Only the active-run polling interval is shortened; no AI or user data is used.
const nativeSetInterval = window.setInterval.bind(window);
window.setInterval = (callback, ms, ...args) => nativeSetInterval(callback, ms === 2500 ? 80 : ms, ...args);
const histories = new Map();
const references = new Map();
const runs = new Map();
const reads = [];
const sends = [];
let listener;
let nextRead;
let failReferences = false;
let failMessages = false;
let polls = 0;
let serial = 0;
const message = (id, role, content) => ({ message_id: id, role, content });
const user = message("user-a", "user", "original user post");
histories.set("a", [user]);
histories.set("b", [message("user-b", "user", "other thread history")]);
const start = (threadId = "a") => {
  const run = { thread_id: threadId, request_id: `restored-${++serial}`, run_id: `run-${serial}`, started_at: new Date().toISOString() };
  runs.set(threadId, run);
  return run;
};
start();
window.cotaskaAPI = {
  settings: { get: async () => ({ configured: { aiChatWorkdir: true }, settings: { aiChat: { provider: "codex", workdir: "C:/test" } } }) },
  aiChat: {
    getDbInfo: async () => ({ ok: true }),
    listThreads: async () => ["a", "b"].map((id) => ({ thread_id: id, title: `Thread ${id}` })),
    listActiveRuns: async () => { polls++; return [...runs.values()]; },
    listMessages: async (id) => {
      reads.push(id);
      if (failMessages) throw new Error("message read failed");
      const snapshot = [...(histories.get(id) || [])];
      const intercept = nextRead;
      nextRead = null;
      return intercept ? intercept(id, snapshot) : snapshot;
    },
    listReferences: async (id) => {
      if (failReferences) throw new Error("reference read failed");
      return [...(references.get(id) || [])];
    },
    listRunEvents: async ({ request_id }) => [{ type: "event", request_id, thread_id: "a",
      event: { type: "item.completed", item: { id: request_id, type: "agent_message", text: `progress ${request_id}` } } }],
    listWorkdirTree: async () => ({ rows: [] }),
    setActiveThread: async () => {},
    onRunEvent: (callback) => { listener = callback; return () => { listener = null; }; },
    onThreadUpdated: () => () => {},
    sendMessage: (input) => new Promise((resolve) => {
      const userMessage = message(input.request_id, "user", input.content);
      histories.set(input.thread_id, [...histories.get(input.thread_id), userMessage]);
      runs.set(input.thread_id, { ...input, started_at: new Date().toISOString() });
      sends.push({ ...input, userMessage, resolve });
      listener({ type: "message.accepted", ...input, userMessage });
    }),
  },
};
const delay = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const text = () => document.body.textContent;
const assert = (value, label) => { if (!value) throw new Error(label); };
async function wait(check, label) {
  for (let i = 0; i < 250; i++) { if (check()) return; await delay(); }
  throw new Error(`Timeout: ${label}; display=${text()}`);
}
async function select(id) {
  [...document.querySelectorAll(".ai-thread-item")].find((row) => row.querySelector(".ai-thread-name")?.textContent === `Thread ${id}`).click();
  await delay();
}
async function send(content) {
  const input = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, content);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await delay();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await delay();
}
function complete(content, threadId = "a") {
  histories.set(threadId, [...histories.get(threadId), message(`answer-${++serial}`, "assistant", content)]);
  runs.delete(threadId);
}
function deferRead() {
  let release;
  nextRead = (_id, snapshot) => new Promise((resolve) => { release = () => resolve(snapshot); });
  return async () => { await wait(() => release, "deferred history read"); return release; };
}
let root;
async function mount() {
  root = createRoot(document.getElementById("root"));
  root.render(<AiChatPane />);
  await wait(() => text().includes("original user post"), "mount loads saved history");
}
async function observeRun() {
  const requestId = runs.get("a").request_id;
  await wait(() => text().includes(`progress ${requestId}`), "restored run is hydrated");
}
async function run() {
  const checks = [];
  await mount();
  await observeRun();
  const before = reads.length;
  complete("restored final answer");
  references.set("a", [{ reference_id: "remaining-ref", label: "remaining.md", ref_type: "file", file_path: "C:/test/remaining.md" }]);
  await wait(() => text().includes("restored final answer") && text().includes("remaining.md"), "completion reloads messages and references");
  assert(reads.length > before, "completion must read saved history");
  await delay(200);
  const settledReads = reads.length;
  await delay(240);
  assert(reads.length === settledReads, "idle polling must not reload history repeatedly");
  checks.push("restored completion syncs once");

  start(); await observeRun();
  root.unmount(); await delay();
  await mount(); await observeRun();
  complete("after remount answer");
  await wait(() => text().includes("after remount answer"), "completion after pane remount");
  checks.push("leave and return while running");
  start(); await observeRun();
  root.unmount(); await delay();
  complete("completed while pane closed");
  await mount();
  await wait(() => text().includes("completed while pane closed"), "closed-pane completion loads on return");
  checks.push("completion while pane is closed");

  start(); await observeRun();
  const getRelease = deferRead();
  complete("deferred foreign answer");
  const release = await getRelease();
  await select("b");
  await wait(() => text().includes("other thread history"), "switch to b");
  release(); await delay(120);
  assert(!text().includes("deferred foreign answer") && !text().includes("remaining.md"), "old messages and references must not enter b");
  await select("a");
  await wait(() => text().includes("deferred foreign answer"), "reopen reads latest history");
  checks.push("switch during completion read");

  await select("b");
  const getOldSelection = deferRead();
  await select("a");
  const releaseOldSelection = await getOldSelection();
  await send("normal local send");
  await wait(() => sends.length === 1, "local send accepted");
  const call = sends[0];
  complete("new local final answer");
  call.resolve({ ok: true, userMessage: call.userMessage, assistantMessage: histories.get("a").at(-1) });
  await wait(() => text().includes("new local final answer"), "normal local completion");
  releaseOldSelection(); await delay(180);
  assert(text().includes("new local final answer"), "old selection snapshot must not erase newer answer");
  checks.push("normal send beats stale selection read");

  start(); await observeRun();
  const getOldCompletion = deferRead();
  complete("old completion snapshot");
  const releaseOldCompletion = await getOldCompletion();
  await send("newer request");
  await wait(() => sends.length === 2, "new request accepted");
  releaseOldCompletion(); await delay(120);
  assert(text().includes("newer request"), "old completion read must not erase accepted post");
  complete("newest answer");
  sends[1].resolve({ ok: true, userMessage: sends[1].userMessage, assistantMessage: histories.get("a").at(-1) });
  await wait(() => text().includes("newest answer"), "new request completion");
  checks.push("new request invalidates older completion read");

  start(); await observeRun();
  failReferences = true;
  const failedReadCount = reads.length;
  complete("answer after retry");
  await wait(() => reads.length > failedReadCount && text().includes("reference read failed"), "read failure surfaced");
  assert(text().includes("newest answer"), "reference read failure must preserve displayed messages");
  failReferences = false;
  await wait(() => text().includes("answer after retry"), "failed completion read retries on next poll");
  checks.push("read failure preserves history and retries");

  start(); await observeRun();
  await select("b");
  complete("background answer");
  const previousPolls = polls;
  await wait(() => polls > previousPolls + 1, "background completion observed");
  assert(text().includes("other thread history") && !text().includes("background answer"), "background run must not update selected history");
  await select("a");
  await wait(() => text().includes("background answer"), "background answer loaded when selected");
  checks.push("background completion is isolated");

  start(); await observeRun();
  const getSameThread = deferRead();
  complete("same selected thread answer");
  const releaseSameThread = await getSameThread();
  await select("a");
  releaseSameThread();
  await wait(() => text().includes("same selected thread answer"), "clicking selected thread does not cancel sync");
  checks.push("click selected thread during sync");

  start(); await observeRun();
  complete("first run before replacement");
  start();
  await observeRun();
  await wait(() => text().includes("first run before replacement"), "replacement request synchronizes previous completion");
  complete("replacement run answer");
  await wait(() => text().includes("replacement run answer"), "replacement request completion");
  checks.push("request replacement without idle poll");

  start(); await observeRun();
  failMessages = true;
  complete("message retry answer");
  await wait(() => text().includes("message read failed"), "message read rejection surfaced");
  assert(text().includes("replacement run answer"), "message read failure must preserve history");
  failMessages = false;
  await wait(() => text().includes("message retry answer"), "message read rejection retries");
  checks.push("message read failure preserves history");

  await send("completion response fallback");
  await wait(() => sends.length === 3, "fallback send accepted");
  failReferences = true;
  complete("completion response survives failed history read");
  sends[2].resolve({ ok: true, userMessage: sends[2].userMessage, assistantMessage: histories.get("a").at(-1) });
  await wait(() => text().includes("completion response survives failed history read"), "completion response is displayed");
  await delay(200);
  assert(text().includes("completion response survives failed history read"), "local completion stays visible after sync failure");
  failReferences = false;
  checks.push("local completion response survives read failure");

  start(); await observeRun();
  const getUnmounted = deferRead();
  complete("answer across unmount");
  const releaseUnmounted = await getUnmounted();
  root.unmount(); await delay();
  complete("latest persisted while closed");
  await mount();
  await wait(() => text().includes("latest persisted while closed"), "new pane has latest answer");
  releaseUnmounted(); await delay(120);
  assert(text().includes("latest persisted while closed"), "old pane read cannot change new pane");
  checks.push("pending read across unmount");
  root.unmount();
  return { ok: true, checks, sends: sends.length };
}
run().then((result) => { window.parallelResult = result; }).catch((error) => { window.parallelResult = { ok: false, error: error.stack }; });
