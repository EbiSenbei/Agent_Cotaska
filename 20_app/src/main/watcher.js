/**
 * watcher.js
 * Watches task files, applies small cache updates, and batches renderer/index refreshes.
 */

const path = require('path');
const chokidar = require('chokidar');
const taskService = require('./taskService');
const indexService = require('./indexService');

const TASK_CHANGE_FLUSH_DELAY_MS = 250;

let activeSession = null;

function scheduleTaskChangeFlush(session) {
  if (session.flushTimer) clearTimeout(session.flushTimer);
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    if (activeSession === session) flushTaskChanges(session);
  }, TASK_CHANGE_FLUSH_DELAY_MS);
}

function flushTaskChanges(session) {
  const events = session.pendingEvents;
  session.pendingEvents = [];
  if (events.length === 0) return { success: true };

  try {
    const cache = taskService.getCache();
    const indexTasks = taskService.getIndexTasksForRebuild();
    const indexResult = indexService.rebuildIndex(indexTasks, taskService.getTaskFileRoots());
    if (!indexResult.success) {
      console.error('[Watcher] Failed to rebuild index:', indexResult.error);
      return indexResult;
    }

    const mainWindow = session.window;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const lastEvent = events[events.length - 1];
      mainWindow.webContents.send('tasks:changed', {
        action: lastEvent.action,
        filePath: lastEvent.filePath,
        events,
        tasks: taskService.getAllTasks(),
        timestamp: new Date().toISOString()
      });

      console.log(`[Watcher] Notified renderer about ${events.length} task file change(s)`);
    }

    console.log(`[Watcher] Flushed task changes - Cache now has ${Object.keys(cache).length} tasks`);
    return { success: true };
  } catch (error) {
    console.error('[Watcher] Error flushing file changes:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Start the file watcher.
 */
async function startWatcher(win) {
  if (activeSession) {
    console.log('[Watcher] Already started');
    return activeSession.ready;
  }

  const session = { window: win, watcher: null, starting: true, pendingEvents: [], flushTimer: null };
  session.ready = new Promise(resolve => { session.resolveReady = resolve; });
  activeSession = session;

  try {
    const searchRoots = taskService.getTaskSearchRoots();

    const watcher = session.watcher = chokidar.watch(searchRoots, {
      ignored: (filePath) => {
        const base = path.basename(filePath);
        return base === '_index.yaml' || base.startsWith('.') || base === 'attachments';
      },
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    for (const action of ['add', 'change', 'unlink']) watcher.on(action, filePath => {
      // Initial add events repeat the full read. Reconcile once at ready instead;
      // this also catches files edited or deleted before monitoring began.
      if (activeSession !== session || session.starting || session.failed) return;
      handleFileChange(session, action, filePath);
    });

    watcher.once('ready', () => {
      if (activeSession !== session || session.failed) return;
      const start = performance.now();
      try {
        const result = taskService.rebuildCache();
        if (!result.success) throw new Error(result.error || '初期タスク照合に失敗しました。');
        session.pendingEvents.push({ action: 'reconcile', filePath: null, timestamp: new Date().toISOString() });
        const flushed = flushTaskChanges(session);
        if (!flushed.success) throw new Error(flushed.error || '初期インデックス同期に失敗しました。');
        session.starting = false;
        console.log(`[Watcher] Initial reconciliation completed in ${Math.round(performance.now() - start)}ms`);
        session.resolveReady({ success: true, taskCount: result.taskCount });
      } catch (error) {
        session.failed = true;
        console.error('[Watcher] Initial reconciliation failed:', error);
        session.resolveReady({ success: false, error: error.message });
      }
    });

    watcher.on('error', (error) => {
      if (activeSession !== session) return;
      console.error('[Watcher] Error:', error);
      if (session.starting) {
        session.failed = true;
        session.resolveReady({ success: false, error: error.message });
      }
    });

    console.log(`[Watcher] Starting monitoring of ${searchRoots.length} root(s)`);
    const result = await session.ready;
    if (!result.success && activeSession === session) await stopWatcher();
    return result;
  } catch (error) {
    console.error('[Watcher] Error starting:', error);
    session.resolveReady({ success: false, error: error.message });
    if (activeSession === session) await stopWatcher();
    return { success: false, error: error.message };
  }
}

function handleFileChange(session, action, filePath) {
  try {
    const applyResult = taskService.applyFileChange(action, filePath);
    if (applyResult.ignored) return;

    if (!applyResult.success) {
      console.error('[Watcher] Failed to apply file change, falling back to full rebuild:', applyResult.error);
      const rebuildResult = taskService.rebuildCache();
      if (!rebuildResult.success) {
        console.error('[Watcher] Failed to rebuild cache:', rebuildResult.error);
        return;
      }
    }

    session.pendingEvents.push({ action, filePath, timestamp: new Date().toISOString() });
    scheduleTaskChangeFlush(session);
  } catch (error) {
    console.error('[Watcher] Error handling file change:', error);
  }
}

/**
 * Stop the file watcher.
 */
async function stopWatcher() {
  const session = activeSession;
  if (!session) return;
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
    flushTaskChanges(session);
  }
  activeSession = null;
  session.resolveReady({ success: false, cancelled: true });
  if (session.watcher) {
    await session.watcher.close();
    console.log('[Watcher] Stopped');
  }
}

module.exports = {
  startWatcher,
  stopWatcher
};
