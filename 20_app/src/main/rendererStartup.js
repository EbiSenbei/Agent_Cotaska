// 初回ナビゲーションだけを扱う。通常利用中の画面遷移では再読み込みしない。
function waitForRendererFirstLoad(win, { logger, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return resolve('no-window');
    const contents = win.webContents;
    const finish = (reason) => {
      clearTimeout(timer);
      contents.removeListener('did-finish-load', onLoaded);
      contents.removeListener('did-fail-load', onFailed);
      contents.removeListener('destroyed', onClosed);
      win.removeListener('closed', onClosed);
      logger?.logInfo('Renderer first load wait finished', { reason });
      resolve(reason);
    };
    const onLoaded = () => finish('loaded');
    const onFailed = (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame !== false) finish('failed');
    };
    const onClosed = () => finish('closed');
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    contents.once('did-finish-load', onLoaded);
    contents.on('did-fail-load', onFailed);
    contents.once('destroyed', onClosed);
    win.once('closed', onClosed);
  });
}

function watchRendererFirstLoad(win, load, {
  logger, delayMs = 20000, graceMs = 5000, maxAttempts = 2,
} = {}) {
  const contents = win.webContents;
  let stopped = false;
  let attempts = 0;
  let loadFailed = false;
  let timer;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    contents.removeListener('did-finish-load', onLoaded);
    contents.removeListener('did-fail-load', onFailed);
    contents.removeListener('destroyed', stop);
    win.removeListener('closed', stop);
  };
  const onFailed = (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame !== false) loadFailed = true;
  };
  // Electronはエラーページでもdid-finish-loadを発火する場合がある。
  const onLoaded = () => { if (!loadFailed) stop(); };
  const unavailable = () => stopped || win.isDestroyed() || contents.isDestroyed();
  const schedule = () => {
    timer = setTimeout(() => {
      if (unavailable()) return stop();
      // メインが長時間停止した直後は、再開したナビゲーションに猶予を与える。
      timer = setTimeout(() => {
        if (unavailable()) return stop();
        const state = { attempt: attempts, url: contents.getURL(), isLoading: contents.isLoading() };
        if (attempts >= maxAttempts) {
          logger?.logError('Renderer load watchdog: give up', state);
          return stop();
        }
        attempts += 1;
        loadFailed = false;
        logger?.logWarning('Renderer load watchdog: reloading', { ...state, attempt: attempts });
        // URLが空の場合にもナビゲーションを開始できるloadFileを呼ぶ。
        try {
          Promise.resolve(load()).catch((error) => logger?.logError('Renderer watchdog load failed', error));
        } catch (error) {
          logger?.logError('Renderer watchdog load failed', error);
        }
        if (!unavailable()) schedule();
      }, graceMs);
    }, delayMs);
  };
  contents.on('did-finish-load', onLoaded);
  contents.on('did-fail-load', onFailed);
  contents.once('destroyed', stop);
  win.once('closed', stop);
  schedule();
  return stop;
}

module.exports = { waitForRendererFirstLoad, watchRendererFirstLoad };
