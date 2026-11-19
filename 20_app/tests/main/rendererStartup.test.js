const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { waitForRendererFirstLoad, watchRendererFirstLoad } = require('../../src/main/rendererStartup');

function windowStub() {
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  win.webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getURL: () => '', isLoading: () => true,
  });
  return win;
}
const logger = () => ({ logInfo: vi.fn(), logWarning: vi.fn(), logError: vi.fn() });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test.each(['loaded', 'failed', 'timeout', 'closed', 'destroyed'])('初回待機を%sで解放しタイマーとリスナーを除去する', async (reason) => {
  const win = windowStub();
  const log = logger();
  const waiting = waitForRendererFirstLoad(win, { logger: log });
  let settled = false;
  waiting.then(() => { settled = true; });
  win.webContents.emit('did-fail-load', {}, -2, 'subframe', '', false);
  await Promise.resolve();
  expect(settled).toBe(false);
  if (reason === 'loaded') win.webContents.emit('did-finish-load');
  if (reason === 'failed') win.webContents.emit('did-fail-load', {}, -2, 'failed', '', true);
  if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15000);
  if (reason === 'closed') win.emit('closed');
  if (reason === 'destroyed') win.webContents.emit('destroyed');
  await expect(waiting).resolves.toBe(reason === 'destroyed' ? 'closed' : reason);
  expect(vi.getTimerCount()).toBe(0);
  expect(win.webContents.eventNames()).toEqual([]);
  expect(win.eventNames()).toEqual([]);
  expect(log.logInfo).toHaveBeenCalledTimes(1);
});

test('存在しない・破棄済みウィンドウは待機しない', async () => {
  await expect(waitForRendererFirstLoad(null)).resolves.toBe('no-window');
  const win = windowStub();
  win.isDestroyed = () => true;
  await expect(waitForRendererFirstLoad(win)).resolves.toBe('no-window');
  expect(vi.getTimerCount()).toBe(0);
});

test('URLが空でも猶予後に再読込し、Promise拒否でも最大2回で停止する', async () => {
  const win = windowStub();
  const log = logger();
  const load = vi.fn().mockRejectedValue(new Error('load failed'));
  watchRendererFirstLoad(win, load, { logger: log });
  await vi.advanceTimersByTimeAsync(20000);
  expect(load).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(25000);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(25000);
  expect(log.logError).toHaveBeenCalledWith('Renderer load watchdog: give up', expect.objectContaining({ attempt: 2, url: '' }));
  expect(vi.getTimerCount()).toBe(0);
  expect(win.eventNames()).toEqual([]);
});

test.each(['did-finish-load', 'closed', 'destroyed'])('猶予中の%sで再試行を止め、その後の遷移も監視しない', async (event) => {
  const win = windowStub();
  const load = vi.fn();
  watchRendererFirstLoad(win, load);
  await vi.advanceTimersByTimeAsync(20000);
  (event === 'closed' ? win : win.webContents).emit(event);
  await vi.advanceTimersByTimeAsync(100000);
  expect(load).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(win.webContents.eventNames()).toEqual([]);
});

test('同期例外の後に再試行成功すると監視を終了する', async () => {
  const win = windowStub();
  const log = logger();
  const load = vi.fn().mockImplementationOnce(() => { throw new Error('sync'); })
    .mockImplementationOnce(() => { win.webContents.emit('did-finish-load'); });
  watchRendererFirstLoad(win, load, { logger: log });
  await vi.advanceTimersByTimeAsync(100000);
  expect(load).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('読み込み失敗後のエラーページ完了を成功と見なさず再試行する', async () => {
  const win = windowStub();
  const load = vi.fn(() => { win.webContents.emit('did-finish-load'); });
  watchRendererFirstLoad(win, load);
  win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', '', true);
  win.webContents.emit('did-finish-load');
  await vi.advanceTimersByTimeAsync(25000);
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

const source = fs.readFileSync(path.join(__dirname, '../../src/main/main.js'), 'utf8');
test.each(['loaded', 'failed', 'timeout', 'closed'])('main起動経路：%sまで初期化とIPCを待ち、閉じた場合は初期化しない', async (reason) => {
  const win = windowStub();
  const initialize = vi.fn(async () => {});
  const scope = {
    createWindow: () => win, projectContext: { hasCurrent: () => true },
    initializeServicesAfterWindowReady: initialize, waitForRendererFirstLoad,
    logger: { info() {}, error() {} }, appLogger: logger(),
  };
  const start = source.indexOf('  // 同期I/Oで初回ナビゲーション');
  const end = source.indexOf('  // 起動後の簡易自己診断', start);
  vm.runInNewContext('let mainWindow; let servicesReady;\n' + source.slice(start, end) + '\nthis.ready = servicesReady;', scope);
  const ipc = vi.fn();
  scope.ready.then(ipc);
  await Promise.resolve();
  expect(initialize).not.toHaveBeenCalled();
  expect(ipc).not.toHaveBeenCalled();
  if (reason === 'loaded') win.webContents.emit('did-finish-load');
  if (reason === 'failed') win.webContents.emit('did-fail-load', {}, -2, 'failed', '', true);
  if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15000);
  if (reason === 'closed') win.emit('closed');
  await scope.ready;
  expect(initialize).toHaveBeenCalledTimes(reason === 'closed' ? 0 : 1);
  expect(ipc).toHaveBeenCalledTimes(1);
});

test('ready-to-showやロード再試行の遅延通知でも進捗率を戻さない', () => {
  const scope = { mainWindow: null };
  const start = source.indexOf('function publishStartupProgress(');
  const end = source.indexOf('\nfunction normalizeVersion', start);
  vm.runInNewContext('let startupProgress = {percent: 0};\n' + source.slice(start, end) + '\nthis.publish = publishStartupProgress; this.get = () => startupProgress;', scope);
  for (const percent of [35, 38, 45, 40, 62, 74, 80, 38]) scope.publish({percent});
  expect(scope.get().percent).toBe(80);
  scope.publish({percent: 200});
  expect(scope.get().percent).toBe(100);
});
