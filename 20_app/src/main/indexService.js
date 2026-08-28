/**
 * indexService.js
 * _index.yaml 自動生成（タスクキャッシュから）
 */

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');
const projectContext = require('./projectContext');

const getTasksDir = () => projectContext.getCurrent().tasksDir;
const getIndexPath = () => projectContext.getCurrent().indexFile;

function normalizeRelativePath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeTaskFilePath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .trim();
}

function normalizeRootPath(rootPath) {
  const normalized = normalizeTaskFilePath(rootPath);
  if (!normalized) return '.';

  if (path.isAbsolute(normalized)) {
    const relativeFromTasks = normalizeRelativePath(path.relative(getTasksDir(), normalized));
    if (!relativeFromTasks || relativeFromTasks.startsWith('..')) return '.';
    return relativeFromTasks;
  }

  return normalizeRelativePath(normalized) || '.';
}

function deriveRootsFromTasks(taskList) {
  const roots = taskList
    .map((task) => {
      const runtimePath = task._filePath || '';
      const pathForRoot = path.isAbsolute(runtimePath)
        ? normalizeRelativePath(path.relative(getTasksDir(), runtimePath))
        : normalizeRelativePath(runtimePath);
      const relPath = pathForRoot && !pathForRoot.startsWith('..') ? pathForRoot : '.';
      const dir = path.posix.dirname(relPath || '.');
      return dir && dir !== '/' ? dir : '.';
    })
    .filter(Boolean);
  return Array.from(new Set(['.', ...roots])).sort();
}

/**
 * キャッシュからインデックスを再構築して _index.yaml に書き込み
 */
function rebuildIndex(taskCache, taskFileRoots = ['.']) {
  try {
    const cacheValues = Array.isArray(taskCache) ? taskCache : Object.values(taskCache);
    // キャッシュからタスク一覧を生成（delete_flag = 0 のみ）
    const taskList = cacheValues
      .filter(t => t.delete_flag !== 1)
      .map(t => ({
        id: t.id,
        title: t.title,
        list: t.list,
        status: t.status,
        priority: t.priority,
        sort_order: t.sort_order,
        tags: t.tags || [],
        due_date: t.due_date,
        updated_at: t.updated_at
      }))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const normalizedRoots = Array.isArray(taskFileRoots) && taskFileRoots.length
      ? Array.from(new Set(taskFileRoots.map((root) => normalizeRootPath(root || '.')).filter(Boolean))).sort()
      : deriveRootsFromTasks(cacheValues);

    // インデックスデータ作成
    const indexData = {
      tasks: taskList,
      task_file_roots: normalizedRoots,
      next_task_id: Math.max(...cacheValues.map(t => {
        const match = t.id.match(/T-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      }), 0) + 1,
      last_updated: new Date().toISOString()
    };

    const yaml = YAML.dump(indexData, { lineWidth: -1 });
    if (fs.existsSync(getIndexPath())) {
      const currentYaml = fs.readFileSync(getIndexPath(), 'utf-8');
      try {
        const currentData = YAML.load(currentYaml) || {};
        const comparableCurrentYaml = YAML.dump(
          { ...currentData, last_updated: indexData.last_updated },
          { lineWidth: -1 }
        );
        if (comparableCurrentYaml === yaml) {
          console.log(`[IndexService] Index unchanged: ${taskList.length} tasks`);
          return { success: true, taskCount: taskList.length, last_updated: currentData.last_updated || null, skipped: true };
        }
      } catch {
        // If the existing index is broken, overwrite it with the regenerated one below.
      }
    }

    // _index.yaml に書き込み
    fs.writeFileSync(getIndexPath(), yaml, 'utf-8');

    console.log(`[IndexService] Rebuilt index: ${taskList.length} tasks`);
    return { success: true, taskCount: taskList.length, last_updated: indexData.last_updated };
  } catch (error) {
    console.error('[IndexService] Error rebuilding index:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  rebuildIndex
};
