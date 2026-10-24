import React from "react";
import { createRoot } from "react-dom/client";
import AiChatPane from "../../src/renderer/components/AiChatPane";

// Only the wall clock is controlled; real React effects and interval cleanup run in Electron.
const epoch = Date.now();
let now = epoch;
Date.now = () => now;
const iso = (time) => new Date(time).toISOString();
const calls = [];
const histories = new Map();
const runs = new Map([
  ["restored", { thread_id: "restored", request_id: "external-claude", started_at: iso(epoch - 40000) }],
  ["missing", { thread_id: "missing", request_id: "external-missing", started_at: "invalid" }],
  ["future", { thread_id: "future", request_id: "external-future", started_at: iso(epoch + 1000000) }],
]);
const threads = ["a", "b", "restored", "missing", "future"].map((id) => ({ thread_id: id, title: `Thread ${id}` }));
let listener;
let holdWorkdir = false;
let releaseWorkdir;
let polls = 0;
const settings = () => ({ configured: { aiChatWorkdir: true }, settings: { aiChat: { workdir: "C:/test", provider: "codex" } } });
function finish(call, failed = false) {
  runs.delete(call.thread_id);
  call.resolve({ ok: !failed, userMessage: call.userMessage });
}
window.cotaskaAPI = {
  settings: { get: () => holdWorkdir ? new Promise((resolve) => { releaseWorkdir = () => resolve(settings()); }) : Promise.resolve(settings()) },
  aiChat: {
    getDbInfo: async () => ({ ok: true }),
    listThreads: async () => threads,
    listActiveRuns: async () => { polls++; return [...runs.values()]; },
    listMessages: async (id) => histories.get(id) || [],
    listReferences: async () => [],
    listWorkdirTree: async () => ({ rows: [] }),
    listRunEvents: async () => [],
    setActiveThread: async () => {},
    onRunEvent: (callback) => { listener = callback; return () => { listener = null; }; },
    onThreadUpdated: () => () => {},
    sendMessage: (input) => new Promise((resolve) => {
      const userMessage = { message_id: input.request_id, role: "user", content: input.content, created_at: iso(now) };
      calls.push({ ...input, resolve, userMessage });
      histories.set(input.thread_id, [...(histories.get(input.thread_id) || []), userMessage]);
      runs.set(input.thread_id, { thread_id: input.thread_id, request_id: input.request_id, started_at: iso(now) });
      listener({ type: "message.accepted", thread_id: input.thread_id, request_id: input.request_id, userMessage });
    }),
    cancelRun: async (id) => { finish(calls.find((call) => call.request_id === id)); return { ok: true }; },
  },
};
const delay = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, label) => { if (!value) throw new Error(label); };
async function wait(check, label) {
  for (let i = 0; i < 180; i++) { if (check()) return; await delay(); }
  throw new Error(`Timeout: ${label}; display=${document.querySelector('.ai-thinking-elapsed')?.textContent}`);
}
const seconds = () => Number(document.querySelector(".ai-thinking-elapsed")?.textContent.match(/\d+/)?.[0]);
async function expectSeconds(value, label) { await wait(() => seconds() === value, label); }
async function select(id) {
  [...document.querySelectorAll(".ai-thread-item")].find((row) => row.textContent === `Thread ${id}`).click();
  await delay();
}
async function send(text) {
  const input = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await delay();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await delay();
}
let root = createRoot(document.getElementById("root"));
root.render(<AiChatPane />);
async function run() {
  await wait(() => document.querySelectorAll(".ai-thread-item").length === 5 && polls > 0, "initial threads and runs");
  await select("missing");
  await expectSeconds(0, "invalid start gets a stable fallback");
  await select("a");
  holdWorkdir = true;
  await send("A1");
  await wait(() => releaseWorkdir, "preparation is deferred");
  await expectSeconds(0, "preparation starts at zero");
  now = epoch + 8000;
  await expectSeconds(8, "preparation is timed");
  await select("b");
  assert(!document.querySelector(".ai-thinking-elapsed"), "idle thread has no timer");
  now = epoch + 30000;
  await select("a");
  await expectSeconds(30, "returning restores preparation time immediately");
  holdWorkdir = false;
  releaseWorkdir();
  await wait(() => calls.length === 1, "A reaches main");
  await expectSeconds(30, "local timer includes preparation after main acceptance");
  const previousPolls = polls;
  await wait(() => polls > previousPolls, "main timestamps are polled");
  await expectSeconds(30, "main timestamp does not move local timer backwards");

  await select("b");
  await send("B1");
  await wait(() => calls.length === 2, "B starts concurrently");
  await expectSeconds(0, "B has its own timer");
  now = epoch + 36000;
  await expectSeconds(6, "B elapsed");
  await select("a");
  await expectSeconds(36, "switching active threads restores A");
  await select("b");
  await expectSeconds(6, "switching active threads restores B");
  await send("B2");
  assert(calls.length === 2, "queued B2 does not start early");
  now = epoch + 46000;
  await expectSeconds(16, "queueing does not reset current run");
  finish(calls[1]);
  await wait(() => calls.length === 3, "FIFO starts next request");
  await expectSeconds(0, "FIFO resets to the new request start");
  now = epoch + 49000;
  await expectSeconds(3, "next request elapsed");
  document.querySelector('[aria-label="AI処理を中断"]').click();
  await wait(() => !document.querySelector(".ai-thinking-elapsed"), "cancel removes timer");
  await select("a");
  await expectSeconds(49, "cancel on B does not affect A");
  finish(calls[0], true);
  await wait(() => !document.querySelector(".ai-thinking-elapsed"), "failure removes timer");

  await select("missing");
  await expectSeconds(49, "invalid timestamp fallback survives polls and switches");
  await select("future");
  await expectSeconds(0, "future timestamps never display negative time");
  await select("restored");
  await expectSeconds(89, "restored run uses main timestamp");
  root.unmount();
  root = createRoot(document.getElementById("root"));
  root.render(<AiChatPane />);
  await wait(() => document.querySelectorAll(".ai-thread-item").length === 5, "remount");
  await select("restored");
  await expectSeconds(89, "remount restores elapsed time");
  now = epoch + 51000;
  await expectSeconds(91, "remounted timer keeps ticking");
  await select("b");
  assert(!document.querySelector(".ai-thinking-elapsed"), "finished thread stays idle");
  return { ok: true, requests: calls.length, checks: "preparation, idle/active thread switches, poll stability, FIFO, cancel/failure cleanup, invalid/future timestamps, main timestamp restoration, remount" };
}
run().then((result) => { window.parallelResult = result; })
  .catch((error) => { window.parallelResult = { ok: false, error: error.stack }; });
