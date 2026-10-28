const { EventEmitter } = require('node:events');
const { flushWindowDrafts } = require('../../src/main/taskDraftFlush');

test('主窓と詳細窓の保存完了を確認し、失敗なら切替を許可しない', async () => {
  const ipc = new EventEmitter(); const sent = [];
  const window = id => ({ isDestroyed: () => false, webContents: { id, send: (channel, token) => sent.push({ channel, token, id }) } });
  const flushing = flushWindowDrafts(ipc, [window(1), window(2)]);
  let finished = false; flushing.then(() => { finished = true; });
  ipc.emit('tasks:draftsFlushed', { sender: { id: 1 } }, sent[0].token, null);
  await Promise.resolve(); expect(finished).toBe(false);
  ipc.emit('tasks:draftsFlushed', { sender: { id: 999 } }, sent[0].token, null);
  ipc.emit('tasks:draftsFlushed', { sender: { id: 2 } }, sent[0].token, null);
  await flushing; expect(ipc.listenerCount('tasks:draftsFlushed')).toBe(0);
  const failed = flushWindowDrafts(ipc, [window(1)]);
  ipc.emit('tasks:draftsFlushed', { sender: { id: 1 } }, sent.at(-1).token, 'disk full');
  await expect(failed).rejects.toThrow('disk full');
  expect(ipc.listenerCount('tasks:draftsFlushed')).toBe(0);
});

test('応答しない画面ではtimeout後に購読を回収する', async () => {
  vi.useFakeTimers();
  try {
    const ipc = new EventEmitter();
    const pending = flushWindowDrafts(ipc, [{ isDestroyed: () => false, webContents: { id: 1, send() {} } }], 10);
    const failed = expect(pending).rejects.toThrow('保存');
    await vi.advanceTimersByTimeAsync(10); await failed;
    expect(ipc.listenerCount('tasks:draftsFlushed')).toBe(0);
  } finally { vi.useRealTimers(); }
});
