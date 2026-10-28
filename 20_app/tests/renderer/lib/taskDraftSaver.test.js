import { createTaskDraftSaver, flushTaskDrafts } from '../../../src/renderer/lib/taskDraftSaver';

const instances = [];
const saver = (options) => { const value = createTaskDraftSaver(options); instances.push(value); return value; };
afterEach(async () => { for (const value of instances.splice(0)) await value.dispose().catch(() => {}); vi.useRealTimers(); });

test('待機中のテキストと優先度を変更項目だけでまとめ、古い項目を送らない', async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => ({ success: true }));
  const draft = saver({ write });
  draft.stage({ title: 'new' });
  await draft.save({ priority: 'high' });
  await vi.advanceTimersByTimeAsync(600);
  expect(write.mock.calls).toEqual([[{ title: 'new', priority: 'high' }]]);
  expect(draft.isDirty('title')).toBe(false);
});

test('遅い保存の完了が新しい未保存編集を消さず、保存を直列化する', async () => {
  let release;
  const write = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ success: true });
  const draft = saver({ write });
  const first = draft.save({ content: 'first' });
  await Promise.resolve(); await Promise.resolve();
  const second = draft.save({ content: 'second' });
  expect(write).toHaveBeenCalledTimes(1);
  release({ success: true }); await first;
  expect(draft.isDirty('content')).toBe(true);
  await second;
  expect(draft.isDirty('content')).toBe(false);
  expect(write.mock.calls).toEqual([[{ content: 'first' }], [{ content: 'second' }]]);
});

test('失敗は未保存のまま再試行でき、後続の新しい編集を戻さない', async () => {
  let reject;
  const onError = vi.fn();
  const write = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ success: true });
  const draft = saver({ write, onError });
  const first = draft.save({ title: 'old' });
  const failed = expect(first).rejects.toThrow('disk');
  await Promise.resolve(); await Promise.resolve();
  const second = draft.save({ title: 'new' });
  reject(new Error('disk')); await failed; await second; await draft.flush();
  expect(write.mock.calls.map(([patch]) => patch.title)).toEqual(['old', 'new']);
  expect(onError).toHaveBeenCalledTimes(1);
});

test('IPCの失敗応答を成功扱いにせず、明示flushで再試行する', async () => {
  const write = vi.fn().mockResolvedValueOnce({ ok: false, error: 'not saved' }).mockResolvedValue({ success: true });
  const draft = saver({ write });
  await expect(draft.save({ title: 'keep' })).rejects.toThrow('not saved');
  expect(draft.isDirty('title')).toBe(true);
  await draft.flush();
  expect(draft.isDirty('title')).toBe(false);
});

test('画面切替前のflushとunmountで待機中の入力を保存する', async () => {
  const write = vi.fn(async () => ({ success: true }));
  const draft = saver({ write }); draft.stage({ content: 'keep' });
  await flushTaskDrafts();
  expect(write).toHaveBeenCalledWith({ content: 'keep' });
  draft.stage({ title: 'before close' }); await draft.dispose();
  expect(write).toHaveBeenLastCalledWith({ title: 'before close' });
});

test('unmount時に失敗したdraftも同じproject/taskを再表示すると復元できる', async () => {
  const draft = saver({ key: 'project-a/task-a', write: async () => ({ ok: false, error: 'offline' }) });
  draft.stage({ content: 'unsaved' });
  await expect(draft.dispose()).rejects.toThrow('offline');
  const write = vi.fn(async () => ({ success: true }));
  const restored = saver({ key: 'project-a/task-a', write });
  expect(restored).toBe(draft);
  expect(restored.value('content', 'old snapshot')).toBe('unsaved');
  await restored.flush(); expect(write).toHaveBeenCalledWith({ content: 'unsaved' });
  expect(restored.value('content', 'saved snapshot')).toBe('saved snapshot');
});
