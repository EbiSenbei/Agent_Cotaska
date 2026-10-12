import React from 'react';
import { createRoot } from 'react-dom/client';
import AiChatPane from '../../src/renderer/components/AiChatPane';

const a = 'thread_12345678-1234-1234-1234-123456789abc';
const b = 'thread_12345678-1234-1234-1234-123456789def';
const threads = [{ thread_id: a, title: 'Image A', primary_task_id: 'T-0742' }, { thread_id: b, title: 'Image B' }];
const refs = new Map();
const histories = new Map();
const pasted = [];
const sent = [];
const runs = new Map();
let accept;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
window.cotaskaAPI = {
  settings: { get: async () => ({ settings: { aiChat: { workdir: 'C:/test', provider: 'codex', referenceSendMode: 'always' } }, configured: { aiChatWorkdir: true } }) },
  aiChat: {
    getDbInfo: async () => ({ ok: true, path: 'C:/test/ai.sqlite' }),
    listThreads: async () => threads,
    listActiveRuns: async () => [...runs.values()],
    listMessages: async (id) => histories.get(id) || [],
    listReferences: async (id) => refs.get(id) || [],
    listProposals: async () => [],
    listWorkdirTree: async () => ({ ok: true, rows: [] }),
    onRunEvent: (listener) => { accept = listener; return () => {}; },
    setActiveThread: async () => ({}),
    previewFile: async () => ({ ok: true, preview_type: 'image', url: `data:image/png;base64,${png}` }),
    pasteImages: (threadId, images) => new Promise((resolve) => {
      const reference = { reference_id: `image-${pasted.length}`, ref_type: 'file', file_path: `cotaska-image:task/T-0742/${threadId}/clip-image_20261012_163025_a7b3c9a7b3c9.png`, label: 'clip-image_20261012_163025_a7b3c9a7b3c9.png' };
      pasted.push({ threadId, images, finish: (ok = true) => { if (ok) refs.set(threadId, [...(refs.get(threadId) || []), reference]); resolve(ok ? { ok: true } : { ok: false, error: '保存失敗' }); } });
    }),
    removeReference: async (id) => { for (const [key, list] of refs) refs.set(key, list.filter((ref) => ref.reference_id !== id)); return { ok: true }; },
    sendMessage: (input) => new Promise((resolve) => {
      const attachments = (refs.get(input.thread_id) || []).map((ref) => ({ id: ref.reference_id, label: ref.label, filePath: ref.file_path }));
      const userMessage = { message_id: 'user', role: 'user', content: input.content, attachments };
      histories.set(input.thread_id, [userMessage]); refs.set(input.thread_id, []);
      runs.set(input.thread_id, { thread_id: input.thread_id, request_id: input.request_id });
      sent.push({ input, finish: () => { runs.delete(input.thread_id); resolve({ ok: true, userMessage, assistantMessage: { message_id: 'reply', role: 'assistant', content: 'done' } }); } });
      accept({ type: 'message.accepted', thread_id: input.thread_id, request_id: input.request_id, userMessage });
    }),
  },
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 40));
async function waitFor(check, label) { for (let i = 0; i < 150; i++) { if (check()) return; await delay(); } throw new Error(label); }
function assert(condition, label) { if (!condition) throw new Error(label); }
async function select(title) { [...document.querySelectorAll('.ai-thread-item')].find((row) => row.textContent.includes(title)).click(); await delay(); }
async function type(value) { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await delay(); }
function paste(type = 'image/png') {
  const data = new DataTransfer();
  if (type === 'text/plain') data.setData(type, 'ordinary text');
  else data.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], 'source.png', { type }));
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  document.querySelector('textarea').dispatchEvent(event);
  return event;
}
createRoot(document.getElementById('root')).render(<AiChatPane />);
async function run() {
  await waitFor(() => document.querySelectorAll('.ai-thread-item').length === 2, 'threads');
  await select('Image A'); await type('この画像を説明');
  const input = document.querySelector('textarea'); input.focus(); input.setSelectionRange(3, 3);
  assert(!paste('text/plain').defaultPrevented, 'normal text paste must remain native');
  assert(paste().defaultPrevented, 'image paste must prevent native HTML/text insertion');
  await waitFor(() => pasted.length === 1, 'image IPC');
  assert(document.querySelector('[aria-label="送信"]').disabled, 'send disabled during save');
  paste(); await delay(); assert(pasted.length === 1, 'double paste blocked while saving');
  assert(input.value === 'この画像を説明' && input.selectionStart === 3, 'draft and selection retained');
  await select('Image B'); pasted[0].finish(); await delay();
  assert(!document.querySelector('.ai-compose-attachment'), 'async attachment must not leak to switched thread');
  await select('Image A');
  await waitFor(() => document.querySelector('.ai-image-thumbnail'), 'thumbnail restored');
  assert(!document.body.textContent.includes('画像も設定の参照送信条件に従います。'), 'no persistent explanation');
  assert(pasted[0].images[0].base64 === png && pasted[0].threadId === a, 'image bytes and original thread');
  document.querySelector('[aria-label$="を外す"]').click();
  await waitFor(() => !document.querySelector('.ai-compose-attachment'), 'remove attachment');
  paste(); await waitFor(() => pasted.length === 2, 'second paste'); pasted[1].finish(false); await delay();
  assert(document.body.textContent.includes('保存失敗'), 'save error visible');
  assert(document.querySelector('textarea').value === 'この画像を説明', 'failure preserves draft');
  paste('image/gif'); await delay(); assert(pasted.length === 2, 'unsupported format rejected');
  paste(); await waitFor(() => pasted.length === 3, 'third paste'); pasted[2].finish(); await delay();
  assert(!document.querySelector('[aria-label="参照ファイル送信"]'), 'reference selector removed');
  assert(!document.body.textContent.includes('今回、画像はAIへ送信されません。'), 'no image warning before sending');
  document.querySelector('[aria-label="送信"]').click();
  await waitFor(() => sent.length === 1, 'send');
  assert(!document.body.textContent.includes('今回、画像はAIへ送信されません。'), 'no image warning after sending');
  paste(); await delay(); assert(pasted.length === 3, 'image paste rejected during AI response');
  assert(sent[0].input.referenceIds.length === 1, 'captured image reference is sent');
  sent[0].finish(); await delay();
  window.parallelResult = { ok: true, checks: ['image paste IPC', 'native text paste', 'draft/cursor', 'save busy', 'thread switching', 'thumbnail', 'remove', 'save failure', 'unsupported format', 'sending busy', 'image send selection'] };
}
run().catch((error) => { window.parallelResult = { ok: false, error: error.stack }; });
