let nextRequest = 0;

function flushWindowDrafts(ipcMain, windows, timeoutMs = 5000) {
  const targets = windows.filter(win => win && !win.isDestroyed());
  if (!targets.length) return Promise.resolve();
  const token = ++nextRequest;
  return new Promise((resolve, reject) => {
    const pending = new Set(targets.map(win => win.webContents.id));
    const finish = (error) => {
      clearTimeout(timer);
      ipcMain.removeListener('tasks:draftsFlushed', listener);
      if (error) reject(error); else resolve();
    };
    const listener = (event, replyToken, error) => {
      if (replyToken !== token || !pending.delete(event.sender.id)) return;
      if (error) finish(new Error(String(error)));
      else if (!pending.size) finish();
    };
    const timer = setTimeout(() => finish(new Error('編集中のタスクの保存を確認できませんでした。画面を確認して再操作してください。')), timeoutMs);
    ipcMain.on('tasks:draftsFlushed', listener);
    try { for (const win of targets) win.webContents.send('tasks:flushDrafts', token); }
    catch (error) { finish(error); }
  });
}
module.exports = { flushWindowDrafts };
