const fs = require('fs');
const path = require('path');
const vm = require('vm');

function bridge() {
  let api;
  const invoke = vi.fn(async () => ({ ok: true }));
  const getPathForFile = vi.fn((file) => file.nativePath || '');
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { if (name === 'cotaskaAPI') api = value; } },
    ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn() },
    webUtils: { getPathForFile },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'), { require: () => electron });
  return { api, invoke, getPathForFile };
}

test('dropped files use Electron paths and send all files to the attachment IPC', async () => {
  const { api, invoke, getPathForFile } = bridge();
  const files = [{ nativePath: 'D:\\資料\\画像.png' }, { nativePath: 'D:\\資料\\参考 PDF.pdf' }];
  await api.attachments.addDroppedFiles('T-0579', files);
  expect(getPathForFile).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledWith('attachments:addDroppedFiles', 'T-0579', files.map((file) => file.nativePath));
});

test('empty or browser-only files do not send a partial attachment request', async () => {
  const { api, invoke } = bridge();
  expect((await api.attachments.addDroppedFiles('T-0579', [])).ok).toBe(false);
  expect((await api.attachments.addDroppedFiles('T-0579', [{ nativePath: 'D:\\a.txt' }, {}])).ok).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});
