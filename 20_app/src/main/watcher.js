/**
 * watcher.js
 * Watches task files, applies small cache updates, and batches renderer/index refreshes.
 */

const path = require('path');
const chokidar = require('chokidar');
const taskService = require('./taskService');
const indexService = require('./indexService');

const TASK_CHANGE_FLUSH_DELAY_MS = 250;

let watcher = null;
let mainWindow = null;
let pendingTaskEvents = [];
let taskChangeFlushTimer = null;

function scheduleTaskChangeFlush() {
  if (taskChangeFlushTimer) clearTimeout(taskChangeFlushTimer);
  taskChangeFlushTimer = setTimeout(() => {
    taskChangeFlushTimer = null;
    flushTaskChanges();
  }, TASK_CHANGE_FLUSH_DELAY_MS);
}

function flushTaskChanges() {
  const events = pendingTaskEvents;
  pendingTaskEvents = [];
  if (events.length === 0) return;

  try {
    const cache = taskService.getCache();
    const indexTasks = taskService.getIndexTasksForRebuild();
    const indexResult = indexService.rebuildIndex(indexTasks, taskService.getTaskFileRoots());
    if (!indexResult.success) {
      console.error('[Watcher] Failed to rebuild index:', indexResult.error);
      return;
    }

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
  } catch (error) {
    console.error('[Watcher] Error flushing file changes:', error);
  }
}

/**
 * Start the file watcher.
 */
async function startWatcher(win) {
  if (watcher) {
    console.log('[Watcher] Already started');
    return;
  }

  mainWindow = win;

  try {
    const searchRoots = taskService.getTaskSearchRoots();

    watcher = chokidar.watch(searchRoots, {
      ignored: (filePath) => {
        const base = path.basename(filePath);
        return base === '_index.yaml' || base.startsWith('.');
      },
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    watcher.on('add', (filePath) => {
      console.log(`[Watcher] File added: ${filePath}`);
      if (path.basename(filePath) !== '_index.yaml') {
        handleFileChange('add', filePath);
      }
    });

    watcher.on('change', (filePath) => {
      console.log(`[Watcher] File changed: ${filePath}`);
      if (path.basename(filePath) !== '_index.yaml') {
        handleFileChange('change', filePath);
      }
    });

    watcher.on('unlink', (filePath) => {
      console.log(`[Watcher] File deleted: ${filePath}`);
      handleFileChange('unlink', filePath);
    });

    watcher.on('error', (error) => {
      console.error('[Watcher] Error:', error);
    });

    console.log('[Watcher] Started monitoring roots:', searchRoots.join(', '));
    return { success: true };
  } catch (error) {
    console.error('[Watcher] Error starting:', error);
    return { success: false, error: error.message };
  }
}

async function handleFileChange(action, filePath) {
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

    pendingTaskEvents.push({ action, filePath, timestamp: new Date().toISOString() });
    scheduleTaskChangeFlush();
    console.log(`[Watcher] Queued ${action} - Cache now has ${Object.keys(taskService.getCache()).length} tasks`);
  } catch (error) {
    console.error('[Watcher] Error handling file change:', error);
  }
}

/**
 * Stop the file watcher.
 */
async function stopWatcher() {
  if (taskChangeFlushTimer) {
    clearTimeout(taskChangeFlushTimer);
    taskChangeFlushTimer = null;
    flushTaskChanges();
  }

  if (watcher) {
    await watcher.close();
    watcher = null;
    console.log('[Watcher] Stopped');
  }
}

module.exports = {
  startWatcher,
  stopWatcher
};
