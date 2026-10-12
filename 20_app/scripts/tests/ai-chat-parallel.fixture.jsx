import React from "react";
import { createRoot } from "react-dom/client";
import AiChatPane from "../../src/renderer/components/AiChatPane";

const calls = [];
const runs = new Map();
const histories = new Map();
const references = new Map([
  ["a", [{ reference_id: "file-a", ref_type: "file", file_path: "C:/test/a.md", label: "a.md" }]],
  ["b", [{ reference_id: "file-b", ref_type: "file", file_path: "C:/test/b.md", label: "b.md" }]],
]);
const threads = [{ thread_id: "a", title: "Thread A" }, { thread_id: "b", title: "Thread B" }];
const creates = [];
let listener;
const message = (id, role, content) => ({ message_id: id, role, content, attachments: [], created_at: new Date().toISOString() });
function finish(call, options = {}) {
  const assistantMessage = message(`reply-${call.request_id}`, "assistant", `reply ${call.content}`);
  histories.get(call.thread_id).push(assistantMessage);
  runs.delete(call.thread_id);
  call.resolve({ ok: !options.failed, canceled: Boolean(options.canceled), userMessage: call.userMessage, assistantMessage });
}
window.cotaskaAPI = {
  settings: { get: async () => ({ configured: { aiChatWorkdir: true }, settings: { aiChat: { workdir: "C:/test", provider: "codex" } } }) },
  aiChat: {
    getDbInfo: async () => ({ ok: true }),
    listThreads: async () => [...threads],
    listActiveRuns: async () => [...runs.values()],
    listMessages: async (id) => [...(histories.get(id) || [])],
    listReferences: async (id) => [...(references.get(id) || [])],
    listWorkdirTree: async () => ({ rows: [] }),
    listRunEvents: async () => [],
    previewFile: async (filePath) => ({ ok: true, path: filePath, label: filePath.split('/').pop(), preview_type: 'text', content: '添付ファイルの内容' }),
    setActiveThread: async () => {},
    onRunEvent: (callback) => { listener = callback; return () => {}; },
    onThreadUpdated: () => () => {},
    createThread: () => new Promise((resolve) => creates.push((id) => {
      const thread = { thread_id: id, title: id };
      threads.push(thread);
      resolve({ ok: true, thread });
    })),
    sendMessage: (input) => new Promise((resolve) => {
      const userMessage = message(`user-${input.request_id}`, "user", input.content);
      userMessage.attachments = input.referenceIds.map((id) => ({ id, label: id, filePath: `C:/test/${id}.md` }));
      references.set(input.thread_id, (references.get(input.thread_id) || []).filter((ref) => !input.referenceIds.includes(ref.reference_id)));
      const call = { ...input, resolve, userMessage };
      calls.push(call);
      runs.set(input.thread_id, { request_id: input.request_id, thread_id: input.thread_id });
      const history = histories.get(input.thread_id) || [];
      history.push(userMessage);
      histories.set(input.thread_id, history);
      listener({ type: "message.accepted", request_id: input.request_id, thread_id: input.thread_id, userMessage });
    }),
    cancelRun: async (id) => { finish(calls.find((call) => call.request_id === id), { canceled: true }); return { ok: true }; },
  },
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
async function waitFor(check, label) {
  for (let i = 0; i < 150; i += 1) {
    if (check()) return;
    await delay();
  }
  throw new Error(`Timeout: ${label}`);
}
function assert(value, label) { if (!value) throw new Error(label); }
async function checkProcessingResize() {
  const handle = document.querySelector('[aria-label="入力欄の高さを変更"]');
  const input = document.querySelector("textarea");
  const initial = parseFloat(input.style.height);
  assert(handle.tabIndex === 0 && handle.getAttribute("aria-disabled") !== "true", "processing resize must be focusable");
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await delay();
  assert(parseFloat(input.style.height) > initial, "keyboard resize while processing");
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  await delay();
  assert(parseFloat(input.style.height) === initial, "Home restores minimum height");
  // Synthetic pointer events have no native capture target; exercise the real drag handlers.
  handle.setPointerCapture = () => {};
  handle.hasPointerCapture = () => false;
  handle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientY: 300, bubbles: true }));
  await delay();
  handle.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientY: 220, bubbles: true }));
  await delay();
  assert(parseFloat(input.style.height) === initial + 80, "pointer resize while processing");
  handle.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  await delay();
  handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await delay();
  assert(parseFloat(input.style.height) === initial, "double-click resets height");
}
async function type(text) {
  const input = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await delay();
}
async function send(text) {
  await type(text);
  const input = document.querySelector("textarea");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await delay();
}
async function select(title) {
  [...document.querySelectorAll(".ai-thread-item")].find((row) => row.textContent.includes(title)).click();
  await delay();
}
createRoot(document.getElementById("root")).render(<AiChatPane />);
async function run() {
  await waitFor(() => document.querySelectorAll(".ai-thread-item").length === 2, "initial threads");
  await select("Thread A");
  assert(!document.querySelector('[aria-label="参照ファイル送信"]'), "reference send selector is removed");
  await send("A1");
  await waitFor(() => calls.length === 1, "A started");
  await checkProcessingResize();
  await send("A2");
  assert(calls.length === 1, "A2 must wait for A1");
  await select("Thread B");
  await send("B1");
  await waitFor(() => calls.length === 2, "B starts while A unresolved");
  assert(calls[1].thread_id === "b", "B has its own request");
  assert(calls[0].referenceIds.join() === "file-a" && calls[1].referenceIds.join() === "file-b", "attachments belong to their threads");
  await send("B2");
  finish(calls[0]);
  await delay(); await delay();
  assert(calls.length === 2, "background A completion must not release B2");
  assert(!document.body.textContent.includes("reply A1"), "A reply must not appear on B");
  assert(document.querySelector('[aria-label="AI処理を中断"]'), "B remains running after A ends");
  await select("Thread A");
  await waitFor(() => calls.length === 3, "A2 starts after reopening A");
  assert(calls[2].content === "A2", "A FIFO preserved");
  assert(calls[2].referenceIds.length === 0, "queued follow-up must not resend A1 attachments");
  await send("A3");
  await select("Thread B");
  document.querySelector('[aria-label="AI処理を中断"]').click();
  await delay(); await delay();
  assert(calls.length === 3, "B cancellation pauses B2");
  finish(calls[2], { failed: true });
  await delay();
  [...document.querySelectorAll("button")].find((button) => button.textContent === "送信を再開").click();
  await waitFor(() => calls.length === 4, "B resumes despite A failure");
  assert(calls[3].content === "B2", "accepted B1 must never be retried");
  await select("Thread A");
  await delay();
  assert(calls.length === 4 && document.querySelector(".ai-send-queue").textContent.includes("A3"), "A failure pauses only A3");
  await select("Thread B");
  await type("編集中の下書き");
  const resizeHandle = document.querySelector('[aria-label="入力欄の高さを変更"]');
  resizeHandle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await delay();
  const draftHeight = document.querySelector("textarea").style.height;
  finish(calls[3]);
  await delay();
  assert(document.querySelector("textarea").value === "編集中の下書き", "completion preserves draft text");
  assert(document.querySelector("textarea").style.height === draftHeight, "completion preserves height while drafting");
  document.querySelector('[title="新しいスレッド"]').click();
  await delay();
  await send("new1");
  await waitFor(() => creates.length === 1, "first draft creates thread");
  await send("new1-followup");
  document.querySelector('[title="新しいスレッド"]').click();
  await delay();
  await send("new2");
  await waitFor(() => creates.length === 2, "second draft creates concurrently");
  creates[0]("new-thread-1");
  await waitFor(() => calls.length === 5, "first draft starts in background");
  assert(document.querySelector(".ai-thread-item.active") === null, "background creation must not change selected draft");
  creates[1]("new-thread-2");
  await waitFor(() => calls.length === 6, "second draft starts concurrently");
  assert(calls[4].thread_id === "new-thread-1" && calls[5].thread_id === "new-thread-2", "drafts remain separate");
  finish(calls[4]);
  await delay();
  assert(!document.body.textContent.includes("reply new1"), "background new reply stays separate");
  await select("new-thread-1");
  await waitFor(() => calls.length === 7, "first draft follow-up binds to created thread");
  assert(calls[6].thread_id === "new-thread-1" && calls[6].content === "new1-followup", "draft FIFO binding");
  finish(calls[5]); finish(calls[6]);
  const attachmentMessage = message('attachment-check', 'user', '添付クリック確認');
  attachmentMessage.attachments = [
    { id: 'task-file', label: 'T-0001.md', filePath: 'C:/test/tasks/T-0001/T-0001.md' },
    { id: 'text-file', label: '日本語 資料.txt', filePath: 'C:/test/日本語 資料.txt' },
  ];
  histories.set('a', [attachmentMessage]);
  await select('Thread A');
  await waitFor(() => document.querySelectorAll('.ai-message-attachments button').length === 2, 'attachment buttons');
  document.querySelectorAll('.ai-message-attachments button')[0].click();
  await waitFor(() => document.querySelector('.ai-task-detail-panel'), 'task attachment opens right task detail');
  assert(document.querySelector('.ai-right-subtitle').textContent === 'T-0001', 'task attachment resolves task ID');
  document.querySelectorAll('.ai-message-attachments button')[1].click();
  await waitFor(() => document.querySelector('.ai-file-preview-editor')?.value === '添付ファイルの内容', 'file attachment opens right file view');
  return { ok: true, requests: calls.length, checks: "parallel threads, FIFO, background replies, cancellation, failure isolation, concurrent drafts, processing resize, draft height preservation" };
}
run().then((result) => { window.parallelResult = result; }).catch((error) => { window.parallelResult = { ok: false, error: error.stack }; });
