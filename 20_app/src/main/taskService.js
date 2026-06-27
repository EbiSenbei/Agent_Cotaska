/**
 * taskService.js
 * タスクファイルのCRUD操作とメモリキャッシュ管理
 * gray-matter で frontmatter と本文を分離・結合
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const YAML = require('js-yaml');
const settingsService = require('./settingsService');

const TASKS_DIR = path.join(process.cwd(), '../data/tasks');
const INDEX_PATH = path.join(TASKS_DIR, '_index.yaml');
const ARCHIVE_DIR = path.join(process.cwd(), '../data/archive');
const DEFAULT_TASK_FILE_ROOTS = ['.'];
const MAX_TASK_TREE_DEPTH = 5;

let taskCache = {};  // メモリキャッシュ
let nextTaskId = 1;
let taskFileRoots = [...DEFAULT_TASK_FILE_ROOTS];
let unloadedTaskSummaries = {};
let knownTaskFilePaths = {};

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

function toIndexAbsolutePath(absPath) {
  return path.resolve(absPath).replace(/\\/g, '/');
}

function toInvalidTaskId(filePath) {
  const relativePath = normalizeRelativePath(path.relative(TASKS_DIR, filePath));
  return `__INVALID__${relativePath || path.basename(filePath)}`;
}

function extractValidationLocation(error) {
  const mark = error?.mark;
  if (!mark) return {};

  const line = typeof mark.line === 'number' ? mark.line + 1 : null;
  const column = typeof mark.column === 'number' ? mark.column + 1 : null;
  return {
    validation_error_line: line,
    validation_error_column: column,
  };
}

function createInvalidTask(filePath, error, reason = null) {
  const absolutePath = normalizeTaskFilePath(toIndexAbsolutePath(filePath));
  const message = reason || error?.message || 'タスクファイルを読み込めませんでした。';
  const fileName = path.basename(filePath);

  return {
    id: toInvalidTaskId(filePath),
    title: `読み込みエラー: ${fileName}`,
    status: 'todo',
    priority: 'high',
    progress_status: '要確認',
    due_date: null,
    deadline_date: null,
    list: null,
    parent: null,
    tags: ['破損タスク'],
    sort_order: 999999,
    delete_flag: 0,
    validation_file_path: absolutePath,
    created_at: null,
    updated_at: null,
    completed_at: null,
    deleted_at: null,
    content: [
      'このタスクファイルは読み込みに失敗しました。',
      '',
      `対象ファイル: ${absolutePath}`,
      `エラー: ${message}`,
    ].join('\n'),
    is_invalid: true,
    validation_error: message,
    validation_error_name: error?.name || 'TaskValidationError',
    ...extractValidationLocation(error),
    _filePath: filePath
  };
}

function assertMutableTask(task) {
  if (task?.is_invalid) {
    throw new Error('破損タスクはCotaska上では編集できません。対象ファイルを直接修正してください。');
  }
}

function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ensureDueDateOnComplete(task, completedDate = localDateString()) {
  if (!task.due_date) {
    task.due_date = completedDate;
  }
}

function normalizeRootPath(rootPath) {
  const normalized = normalizeTaskFilePath(rootPath);
  if (!normalized) return '.';

  if (path.isAbsolute(normalized)) {
    const relativeFromTasks = normalizeRelativePath(path.relative(TASKS_DIR, normalized));
    if (!relativeFromTasks || relativeFromTasks.startsWith('..')) return '.';
    return relativeFromTasks;
  }

  return normalizeRelativePath(normalized) || '.';
}

function toIndexRelativePath(absPath) {
  return path.relative(TASKS_DIR, absPath).replace(/\\/g, '/');
}

function resolveTaskFilePath(taskFilePath, fallbackTaskId = null) {
  const normalized = normalizeTaskFilePath(taskFilePath);
  if (normalized) {
    if (path.isAbsolute(normalized)) return path.normalize(normalized);
    return path.join(TASKS_DIR, normalizeRelativePath(normalized));
  }
  if (fallbackTaskId) return path.join(TASKS_DIR, `${fallbackTaskId}.md`);
  throw new Error('fallbackTaskId is required');
}

function ensureParentDir(filePath) {
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
}

function readIndexData() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { next_task_id: 1, tasks: [], task_file_roots: [...DEFAULT_TASK_FILE_ROOTS] };
  }

  try {
    const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');
    const indexData = YAML.load(indexContent) || {};
    return {
      next_task_id: indexData.next_task_id || 1,
      tasks: Array.isArray(indexData.tasks) ? indexData.tasks : [],
      task_file_roots: Array.isArray(indexData.task_file_roots) && indexData.task_file_roots.length
        ? Array.from(new Set(indexData.task_file_roots.map((root) => normalizeRootPath(root || '.')).filter(Boolean)))
        : [...DEFAULT_TASK_FILE_ROOTS]
    };
  } catch (error) {
    console.warn('[TaskService] Failed to parse _index.yaml, fallback to default roots:', error.message);
    return { next_task_id: 1, tasks: [], task_file_roots: [...DEFAULT_TASK_FILE_ROOTS] };
  }
}

function collectTaskFilesFromRoots(roots) {
  const files = [];
  const visited = new Set();

  const walk = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    const resolvedDir = path.resolve(dirPath);
    if (visited.has(resolvedDir)) return;
    visited.add(resolvedDir);

    fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        return;
      }

      if (!entry.isFile()) return;
      if (!entry.name.endsWith('.md')) return;
      if (entry.name === '_index.yaml') return;
      files.push(entryPath);
    });
  };

  roots.forEach((rootRel) => {
    const normalizedRoot = normalizeRelativePath(rootRel || '.');
    const absRoot = path.join(TASKS_DIR, normalizedRoot || '.');
    walk(absRoot);
  });

  // 既存運用との互換性のため、ルート直下スキャンは常に含める
  walk(TASKS_DIR);

  return Array.from(new Set(files));
}

function loadTaskFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(content);
    const hasLegacyTaskFilePath = Object.prototype.hasOwnProperty.call(parsed.data || {}, 'task_file_path');
    const hasLegacyProgress = Object.prototype.hasOwnProperty.call(parsed.data || {}, 'progress');
    const task = {
      ...parsed.data,
      content: parsed.content,
      _filePath: filePath
    };
    // 廃止済みフィールドを読み込み時に除去
    delete task.is_manual_progress;
    delete task.task_file_path;
    delete task.progress;
    if (hasLegacyTaskFilePath || hasLegacyProgress) {
      task._needsLegacyPathCleanup = true;
    }

    if (!String(task.id || '').trim()) {
      return createInvalidTask(filePath, null, 'frontmatter に id がありません。');
    }

    return task;
  } catch (error) {
    console.warn(`[TaskService] Failed to load task file: ${filePath}`, error.message);
    return createInvalidTask(filePath, error);
  }
}

function deriveTaskFileRootsFromCache(cache) {
  const roots = Object.values(cache)
    .map((task) => {
      const filePath = task._filePath || resolveTaskFilePath(null, task.id);
      const relPath = normalizeRelativePath(toIndexRelativePath(filePath));
      const dir = path.posix.dirname(relPath || '.');
      return dir && dir !== '/' ? dir : '.';
    })
    .filter(Boolean);
  return Array.from(new Set([ ...DEFAULT_TASK_FILE_ROOTS, ...roots ])).sort();
}

function sanitizeTaskForRenderer(task) {
  const output = { ...task };
  delete output._filePath;
  delete output._needsLegacyPathCleanup;
  delete output.task_file_path;
  return output;
}

function refreshNextTaskIdFromCache() {
  const maxTaskNo = Math.max(
    ...getIndexTasksForRebuild().map((task) => {
      const match = String(task.id || '').match(/T-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }),
    0
  );
  nextTaskId = Math.max(nextTaskId, maxTaskNo + 1);
}

function getTaskLoadingSettings() {
  const settings = settingsService.getSettings().settings || {};
  return {
    completedInitialLimit: Number(settings.taskLoading?.completedInitialLimit ?? 100),
    completedLoadMoreLimit: Number(settings.taskLoading?.completedLoadMoreLimit ?? 100),
  };
}

function getTaskIdFromFilePath(filePath) {
  const match = path.basename(filePath, '.md').match(/^T-\d+$/);
  return match ? match[0] : null;
}

function compareSummaryUpdatedDesc(a, b) {
  const aValue = Date.parse(a?.updated_at || '') || 0;
  const bValue = Date.parse(b?.updated_at || '') || 0;
  return bValue - aValue || String(b?.id || '').localeCompare(String(a?.id || ''), 'ja', { numeric: true });
}

function sortCompletedSummaries(summaries) {
  return [...summaries].sort(compareSummaryUpdatedDesc);
}

function getUnloadedIndexTasks() {
  return Object.values(unloadedTaskSummaries);
}

function getIndexTasksForRebuild() {
  return [
    ...getUnloadedIndexTasks(),
    ...Object.values(taskCache),
  ];
}

function removeTaskCacheEntriesByFilePath(filePath) {
  const targetPath = toIndexAbsolutePath(filePath);
  let removed = 0;

  Object.entries(knownTaskFilePaths).forEach(([taskId, knownPath]) => {
    if (toIndexAbsolutePath(knownPath) === targetPath) {
      delete knownTaskFilePaths[taskId];
    }
  });

  Object.entries(taskCache).forEach(([taskId, task]) => {
    const taskFilePath = task._filePath || resolveTaskFilePath(null, task.id);
    if (toIndexAbsolutePath(taskFilePath) === targetPath) {
      delete taskCache[taskId];
      removed += 1;
    }
  });

  return removed;
}

function loadTaskFileIntoCache(filePath) {
  removeTaskCacheEntriesByFilePath(filePath);

  const task = loadTaskFromFile(filePath);
  if (!task.id) return { changed: false };
  knownTaskFilePaths[task.id] = filePath;
  delete unloadedTaskSummaries[task.id];

  const existing = taskCache[task.id];
  if (existing) {
    const existingPath = existing._filePath || resolveTaskFilePath(null, existing.id);
    if (toIndexAbsolutePath(existingPath) !== toIndexAbsolutePath(filePath)) {
      const duplicate = createInvalidTask(
        filePath,
        null,
        `Task ID is duplicated: ${task.id}`
      );
      taskCache[duplicate.id] = duplicate;
      return { changed: true, taskId: duplicate.id };
    }
  }

  taskCache[task.id] = task;

  if (!task.is_invalid && task._needsLegacyPathCleanup) {
    writeTaskFile(task);
  }

  return { changed: true, taskId: task.id };
}

function loadAllTasksAndMigratePath() {
  const taskFiles = collectTaskFilesFromRoots(taskFileRoots);
  taskCache = {};
  unloadedTaskSummaries = {};
  knownTaskFilePaths = {};

  taskFiles.forEach((filePath) => {
    const task = loadTaskFromFile(filePath);
    if (!task.id) return;
    knownTaskFilePaths[task.id] = filePath;

    if (taskCache[task.id]) {
      const duplicate = createInvalidTask(
        filePath,
        null,
        `タスクIDが重複しています: ${task.id}`
      );
      taskCache[duplicate.id] = duplicate;
      return;
    }

    taskCache[task.id] = task;

    if (task.is_invalid) return;

    // 移行: 廃止済み task_file_path が残っていれば正本から除去する
    if (task._needsLegacyPathCleanup) {
      writeTaskFile(task);
    }
  });

  refreshNextTaskIdFromCache();
  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);
}

function loadInitialTasksFromIndex(indexTasks) {
  if (!Array.isArray(indexTasks) || indexTasks.length === 0) {
    loadInitialTasksFromIndex(indexData.tasks);
    return;
  }

  const taskFiles = collectTaskFilesFromRoots(taskFileRoots);
  taskCache = {};
  unloadedTaskSummaries = {};
  knownTaskFilePaths = {};

  const fileById = new Map();
  taskFiles.forEach((filePath) => {
    const id = getTaskIdFromFilePath(filePath);
    if (id && !fileById.has(id)) {
      fileById.set(id, filePath);
      knownTaskFilePaths[id] = filePath;
    }
  });

  const { completedInitialLimit } = getTaskLoadingSettings();
  const summariesById = new Map(indexTasks.map((task) => [task.id, task]));
  const activeIds = indexTasks
    .filter((task) => task.status !== 'done')
    .map((task) => task.id);
  const initialCompletedIds = sortCompletedSummaries(indexTasks.filter((task) => task.status === 'done'))
    .slice(0, Math.max(0, completedInitialLimit))
    .map((task) => task.id);
  const selectedIds = new Set([...activeIds, ...initialCompletedIds]);
  const loadedFilePaths = new Set();

  selectedIds.forEach((taskId) => {
    const filePath = fileById.get(taskId);
    if (!filePath) return;
    loadTaskFileIntoCache(filePath);
    loadedFilePaths.add(toIndexAbsolutePath(filePath));
  });

  taskFiles.forEach((filePath) => {
    if (loadedFilePaths.has(toIndexAbsolutePath(filePath))) return;
    const taskId = getTaskIdFromFilePath(filePath);
    if (taskId && summariesById.has(taskId)) return;
    loadTaskFileIntoCache(filePath);
  });

  indexTasks.forEach((summary) => {
    if (!summary?.id || taskCache[summary.id]) return;
    unloadedTaskSummaries[summary.id] = { ...summary };
  });

  refreshNextTaskIdFromCache();
  taskFileRoots = deriveTaskFileRootsFromCache(getIndexTasksForRebuild());
}

function applyFileChange(action, filePath) {
  try {
    if (path.basename(filePath) === '_index.yaml' || path.extname(filePath).toLowerCase() !== '.md') {
      return { success: true, changed: false, ignored: true };
    }

    let result = { changed: false };
    if (action === 'unlink') {
      result = { changed: removeTaskCacheEntriesByFilePath(filePath) > 0 };
      const taskId = getTaskIdFromFilePath(filePath);
      if (taskId && unloadedTaskSummaries[taskId]) {
        delete unloadedTaskSummaries[taskId];
        result.changed = true;
      }
    } else {
      result = loadTaskFileIntoCache(filePath);
    }

    refreshNextTaskIdFromCache();
    taskFileRoots = deriveTaskFileRootsFromCache(getIndexTasksForRebuild());

    return {
      success: true,
      changed: result.changed,
      taskId: result.taskId || null,
      taskCount: Object.keys(taskCache).length
    };
  } catch (error) {
    console.error('[TaskService] Error applying file change:', error);
    return { success: false, error: error.message };
  }
}

function getFilePathForTaskId(taskId) {
  const loaded = taskCache[taskId];
  if (loaded) return loaded._filePath || resolveTaskFilePath(null, taskId);
  if (knownTaskFilePaths[taskId]) return knownTaskFilePaths[taskId];
  if (unloadedTaskSummaries[taskId]) return resolveTaskFilePath(null, taskId);
  return resolveTaskFilePath(null, taskId);
}

function loadTaskById(taskId) {
  if (taskCache[taskId]) return taskCache[taskId];
  const filePath = getFilePathForTaskId(taskId);
  const result = loadTaskFileIntoCache(filePath);
  return result.changed ? taskCache[result.taskId] : null;
}

function getLoadedCompletedTasksSorted() {
  return Object.values(taskCache)
    .filter((t) => t.status === 'done' && t.delete_flag === 0)
    .sort((a, b) => compareSummaryUpdatedDesc(a, b));
}

function getCompletedTaskSummariesSorted() {
  return sortCompletedSummaries([
    ...getLoadedCompletedTasksSorted(),
    ...Object.values(unloadedTaskSummaries).filter((task) => task.status === 'done'),
  ]);
}

function ensureCompletedTasksLoaded(limit) {
  const target = Math.max(0, Number(limit) || 0);
  if (target === 0) return;

  const summaries = getCompletedTaskSummariesSorted();
  for (const summary of summaries) {
    if (getLoadedCompletedTasksSorted().length >= target) break;
    if (!summary?.id || taskCache[summary.id]) continue;
    loadTaskById(summary.id);
  }
}

function normalizeProgressStatus(task) {
  return task.progress_status || (task.status === 'done' ? '完了' : '未着');
}

function getTaskDepth(taskId, seen = new Set()) {
  const task = taskCache[taskId];
  if (!task || !task.parent) return 1;
  if (seen.has(taskId)) return MAX_TASK_TREE_DEPTH + 1;
  seen.add(taskId);
  return getTaskDepth(task.parent, seen) + 1;
}

function getTaskSubtreeDepth(taskId, seen = new Set()) {
  if (!taskId || seen.has(taskId)) return MAX_TASK_TREE_DEPTH + 1;
  const task = taskCache[taskId];
  if (!task || task.delete_flag === 1 || task.is_invalid) return 1;
  const nextSeen = new Set(seen);
  nextSeen.add(taskId);
  const children = Object.values(taskCache)
    .filter((child) => child.parent === taskId && child.delete_flag === 0 && !child.is_invalid);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => getTaskSubtreeDepth(child.id, nextSeen)));
}

function validateParentUpdate(taskId, nextParentId) {
  if (!nextParentId) return;
  if (taskId === nextParentId) {
    throw new Error('自分自身を親タスクにはできません。');
  }

  const parent = taskCache[nextParentId];
  if (!parent || parent.delete_flag === 1 || parent.is_invalid) {
    throw new Error('指定された親タスクが見つかりません。');
  }

  let currentParentId = nextParentId;
  const seen = new Set();
  while (currentParentId) {
    if (currentParentId === taskId) {
      throw new Error('子孫タスクを親にすると循環参照になります。');
    }
    if (seen.has(currentParentId)) {
      throw new Error('親子関係に循環参照があります。');
    }
    seen.add(currentParentId);
    currentParentId = taskCache[currentParentId]?.parent || null;
  }

  const nextMaxDepth = getTaskDepth(nextParentId) + getTaskSubtreeDepth(taskId);
  if (nextMaxDepth > MAX_TASK_TREE_DEPTH) {
    throw new Error('タスク階層は最大5階層までです。');
  }
}

function collectDescendantTasks(parentId, maxDepth = MAX_TASK_TREE_DEPTH) {
  const descendants = [];
  const walk = (currentParentId, depth, seen = new Set()) => {
    if (depth >= maxDepth || seen.has(currentParentId)) return;
    seen.add(currentParentId);
    Object.values(taskCache).forEach((child) => {
      if (child.parent !== currentParentId || child.delete_flag === 1 || child.is_invalid) return;
      descendants.push(child);
      walk(child.id, depth + 1, new Set(seen));
    });
  };
  walk(parentId, 1);
  return descendants;
}

function estimateParentState(parent, children) {
  const parentStatus = normalizeProgressStatus(parent);
  if (parentStatus !== '未着') return null;

  const statuses = children.map((child) => normalizeProgressStatus(child));
  if (statuses.some((status) => status === '仕掛' || status === '完了')) {
    return { progress_status: '仕掛', status: 'todo' };
  }
  return null;
}

function recomputeParentFromChildren(parentId, now) {
  if (!parentId) return;
  const parent = taskCache[parentId];
  if (!parent || parent.delete_flag === 1) return;

  const siblings = Object.values(taskCache)
    .filter((child) => child.parent === parentId && child.delete_flag === 0);
  const estimatedParent = estimateParentState(parent, siblings);
  if (!estimatedParent) return;

  parent.progress_status = estimatedParent.progress_status;
  parent.status = estimatedParent.status;
  parent.completed_at = estimatedParent.status === 'done' ? (parent.completed_at || now) : null;
  parent.updated_at = now;
  taskCache[parent.id] = parent;
  writeTaskFile(parent);
  if (parent.parent) {
    recomputeParentFromChildren(parent.parent, now);
  }
}

/**
 * 起動時に全タスクファイルを読み込みキャッシュを構築
 */
async function openTaskService() {
  try {
    // 30_data/tasks/ が存在しない場合は作成
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }

    // _index.yaml から next_task_id / task_file_roots を読み込む
    const indexData = readIndexData();
    nextTaskId = indexData.next_task_id;
    taskFileRoots = indexData.task_file_roots;

    // ルート群から全タスクファイルを読み込み（移行補完含む）
    loadAllTasksAndMigratePath();

    // _index.yaml を最新スキーマで再生成
    const indexService = require('./indexService');
    indexService.rebuildIndex(getIndexTasksForRebuild(), taskFileRoots);

    console.log(`[TaskService] Loaded ${Object.keys(taskCache).length} tasks from disk`);
    return { success: true, taskCount: Object.keys(taskCache).length };
  } catch (error) {
    console.error('[TaskService] Error opening service:', error);
    throw error;
  }
}

/**
 * delete_flag = 0 のタスクを返す
 */
function getAllTasks() {
  return Object.values(taskCache)
    .filter((t) => t.delete_flag === 0)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * status = done のタスクを返す
 */
function getCompletedTasks(options = {}) {
  const settings = getTaskLoadingSettings();
  const limit = Math.max(0, Number(options.limit ?? settings.completedInitialLimit) || 0);
  ensureCompletedTasksLoaded(limit);
  const tasks = getLoadedCompletedTasksSorted();
  return tasks.slice(0, limit).map((t) => sanitizeTaskForRenderer(t));
}

function getCompletedTaskPage(options = {}) {
  const settings = getTaskLoadingSettings();
  const limit = Math.max(0, Number(options.limit ?? settings.completedInitialLimit) || 0);
  ensureCompletedTasksLoaded(limit);
  const loaded = getLoadedCompletedTasksSorted();
  const allSummaries = getCompletedTaskSummariesSorted();
  return {
    tasks: loaded.slice(0, limit).map((t) => sanitizeTaskForRenderer(t)),
    loadedCount: Math.min(loaded.length, limit),
    hasMore: allSummaries.length > limit,
    nextLimit: limit + Math.max(1, settings.completedLoadMoreLimit),
  };
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function getSearchableValues(task) {
  const tags = task.tags || [];
  return [
    task.id,
    task.title,
    task.content,
    task.list,
    task.priority,
    task.progress_status,
    task.due_date,
    task.deadline_date,
    ...(Array.isArray(tags) ? tags : []),
    ...(Array.isArray(tags) ? tags.map((tag) => `#${tag}`) : []),
  ].map(normalizeSearchText).filter(Boolean);
}

function taskMatchesKeyword(task, keywords) {
  if (!keywords.length) return false;
  const haystack = getSearchableValues(task).join('\n');
  return keywords.every((keyword) => haystack.includes(keyword));
}

function searchTasks(keyword) {
  const keywords = normalizeSearchText(keyword).split(/\s+/).filter(Boolean);
  if (!keywords.length) return [];

  const matchedById = new Map();
  Object.values(taskCache).forEach((task) => {
    if (task.delete_flag === 0 && taskMatchesKeyword(task, keywords)) {
      matchedById.set(task.id, task);
    }
  });

  Object.values(unloadedTaskSummaries).forEach((summary) => {
    if (!summary?.id || summary.delete_flag === 1 || matchedById.has(summary.id)) return;
    const filePath = getFilePathForTaskId(summary.id);
    const task = filePath ? loadTaskFromFile(filePath) : null;
    if (task && !task.is_invalid && task.delete_flag === 0 && taskMatchesKeyword(task, keywords)) {
      taskCache[task.id] = task;
      delete unloadedTaskSummaries[task.id];
      matchedById.set(task.id, task);
    }
  });

  return Array.from(matchedById.values()).map((task) => sanitizeTaskForRenderer(task));
}

/**
 * delete_flag = 1 のタスクを返す
 */
function getTrashedTasks() {
  return Object.values(taskCache)
    .filter((t) => t.delete_flag === 1)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * ID でタスク取得
 */
function getTaskById(id) {
  const task = taskCache[id];
  return task ? sanitizeTaskForRenderer(task) : null;
}

/**
 * リスト別タスク取得
 */
function getTasksByList(listName) {
  return Object.values(taskCache)
    .filter((t) => t.list === listName && t.delete_flag === 0)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * 親タスク配下のサブタスク取得
 */
function getTasksByParent(parentId) {
  return Object.values(taskCache)
    .filter((t) => t.parent === parentId && t.delete_flag === 0)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * 新規タスク作成
 */
function addTask(taskData) {
  if (taskData.parent && getTaskDepth(taskData.parent) >= MAX_TASK_TREE_DEPTH) {
    throw new Error('タスク階層は最大5階層までです。');
  }

  // ID 自動採番
  const newId = `T-${String(nextTaskId).padStart(4, '0')}`;
  nextTaskId++;

  const taskFilePath = resolveTaskFilePath(null, newId);

  const now = new Date().toISOString();
  const newTask = {
    id: newId,
    title: taskData.title || 'Untitled',
    status: 'todo',
    priority: taskData.priority || 'medium',
    progress_status: '未着',
    due_date: taskData.due_date || null,
    deadline_date: taskData.deadline_date || null,
    list: taskData.list || null,
    parent: taskData.parent || null,
    tags: taskData.tags || [],
    sort_order: Object.keys(taskCache).length + 1,
    delete_flag: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
    deleted_at: null,
    content: '',
    _filePath: taskFilePath
  };

  // キャッシュに追加
  taskCache[newId] = newTask;

  // ファイルに書き込み
  writeTaskFile(newTask);
  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);

  return sanitizeTaskForRenderer(newTask);
}

/**
 * タスク更新（frontmatter フィールド）
 */
function updateTask(id, updates) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const task = taskCache[id];
  assertMutableTask(task);
  const oldFilePath = task._filePath || resolveTaskFilePath(null, id);
  const prevStatus = task.status;
  const prevProgressStatus = task.progress_status;
  const prevParent = task.parent || null;
  const now = new Date().toISOString();

  // 廃止済みフィールドは入力されても無視する
  if (Object.prototype.hasOwnProperty.call(updates, 'is_manual_progress')) {
    delete updates.is_manual_progress;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'task_file_path')) {
    delete updates.task_file_path;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'progress')) {
    delete updates.progress;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'parent')) {
    const currentParent = task.parent || null;
    const nextParent = updates.parent || null;
    if (currentParent !== nextParent) {
      validateParentUpdate(id, nextParent);
    }
  }

  // 全フィールドを更新（content を含む）
  Object.keys(updates).forEach(key => {
    task[key] = updates[key];
  });

  // status/progress_status の不整合を補正
  if (task.status === 'done') {
    task.progress_status = '完了';
    task.completed_at = task.completed_at || now;
    ensureDueDateOnComplete(task);
  } else {
    if (task.progress_status === '完了') {
      task.progress_status = '仕掛';
    }
    task.completed_at = null;
  }

  task.updated_at = now;

  task._filePath = oldFilePath;
  delete task.task_file_path;

  // 親タスクが todo/doing/blocked -> done に遷移した場合、直下サブタスクを自動完了
  const descendants = collectDescendantTasks(id);
  const isParentTask = descendants.length > 0;
  if (isParentTask && prevStatus !== 'done' && task.status === 'done') {
    descendants.forEach((child) => {
      if (child.status === 'done' && child.progress_status === '完了') return;

      child.status = 'done';
      child.progress_status = '完了';
      child.completed_at = child.completed_at || now;
      ensureDueDateOnComplete(child);
      child.updated_at = now;
      taskCache[child.id] = child;
      writeTaskFile(child);
    });
  }

  // BUG-20260505-02: 親を保留にした場合は未完了の子孫も保留へ同期する。
  if (isParentTask && prevProgressStatus !== '保留' && task.progress_status === '保留') {
    descendants.forEach((child) => {
      const childProgressStatus = normalizeProgressStatus(child);
      if (child.status === 'done' || childProgressStatus === '完了') return;
      if (childProgressStatus !== '未着' && childProgressStatus !== '仕掛') return;

      child.status = 'todo';
      child.progress_status = '保留';
      child.completed_at = null;
      child.updated_at = now;
      taskCache[child.id] = child;
      writeTaskFile(child);
    });
  }

  // BUG-20260505-02: 親の保留を解除した場合は、保留中の子孫だけ同方向へ戻す。
  if (
    isParentTask &&
    prevProgressStatus === '保留' &&
    task.progress_status !== '保留' &&
    task.progress_status !== '完了'
  ) {
    descendants.forEach((child) => {
      if (child.status === 'done' || normalizeProgressStatus(child) !== '保留') return;

      child.status = 'todo';
      child.progress_status = task.progress_status;
      child.completed_at = null;
      child.updated_at = now;
      taskCache[child.id] = child;
      writeTaskFile(child);
    });
  }

  // CHG-010: 親タスクの進捗ステータスが 完了 -> 非完了 に戻った場合、直下サブタスクも同方向へ戻す
  if (isParentTask && prevProgressStatus === '完了' && task.progress_status !== '完了') {
    descendants.forEach((child) => {
      child.progress_status = task.progress_status;
      child.status = 'todo';
      child.completed_at = null;
      child.updated_at = now;
      taskCache[child.id] = child;
      writeTaskFile(child);
    });
  }

  // CHG-012: 子タスク更新時に親タスクの progress_status / status を再推定
  if (prevParent && prevParent !== task.parent) recomputeParentFromChildren(prevParent, now);
  if (task.parent) recomputeParentFromChildren(task.parent, now);

  // キャッシュ更新
  taskCache[id] = task;

  // ファイルに書き込み
  writeTaskFile(task);
  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);

  return { success: true, updated_at: now };
}

/**
 * 本文編集（content は別途管理）
 */
function updateTaskContent(id, content) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const task = taskCache[id];
  assertMutableTask(task);
  const now = new Date().toISOString();

  task.content = content;
  task.updated_at = now;
  task._filePath = task._filePath || resolveTaskFilePath(null, id);
  delete task.task_file_path;

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, updated_at: now };
}

/**
 * タスクのタグ配列を更新
 */
function updateTaskTags(id, tags) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const normalizedTags = Array.isArray(tags)
    ? Array.from(new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))).slice(0, 10)
    : [];

  const now = new Date().toISOString();
  const task = taskCache[id];
  assertMutableTask(task);

  task.tags = normalizedTags;
  task.updated_at = now;
  task._filePath = task._filePath || resolveTaskFilePath(null, id);
  delete task.task_file_path;

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, updated_at: now, tags: normalizedTags };
}

/**
 * タスク完了
 */
function completeTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];
  assertMutableTask(task);

  task.status = 'done';
  task.completed_at = now;
  task.progress_status = '完了';
  ensureDueDateOnComplete(task);
  task.updated_at = now;
  task._filePath = task._filePath || resolveTaskFilePath(null, id);
  delete task.task_file_path;

  taskCache[id] = task;
  writeTaskFile(task);
  collectDescendantTasks(id).forEach((child) => {
    if (child.status === 'done' && child.progress_status === '完了') return;
    child.status = 'done';
    child.completed_at = child.completed_at || now;
    child.progress_status = '完了';
    ensureDueDateOnComplete(child);
    child.updated_at = now;
    taskCache[child.id] = child;
    writeTaskFile(child);
  });
  if (task.parent) recomputeParentFromChildren(task.parent, now);

  return { success: true, completed_at: now };
}

/**
 * タスク再開
 */
function reopenTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];
  assertMutableTask(task);

  task.status = 'todo';
  task.completed_at = null;
  task.updated_at = now;
  task._filePath = task._filePath || resolveTaskFilePath(null, id);
  delete task.task_file_path;

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true };
}

/**
 * タスク削除（ゴミ箱移動）
 */
function trashTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];
  assertMutableTask(task);

  task.delete_flag = 1;
  task.deleted_at = now;
  task.updated_at = now;
  task._filePath = task._filePath || resolveTaskFilePath(null, id);
  delete task.task_file_path;

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, deleted_at: now };
}

/**
 * タスク復元
 */
function restoreTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];
  assertMutableTask(task);

  task.delete_flag = 0;
  task.deleted_at = null;
  task.updated_at = now;
  task._filePath = task._filePath || resolveTaskFilePath(null, id);
  delete task.task_file_path;

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true };
}

/**
 * タスク完全削除（archive へ移動）
 */
function deleteTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const task = taskCache[id];
  assertMutableTask(task);
  const filePath = task._filePath || resolveTaskFilePath(null, id);
  const archivePath = path.join(ARCHIVE_DIR, `${id}-archived.md`);

  // archive ディレクトリが無ければ作成
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  // ファイルを archive へ移動
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, archivePath);
  }

  // キャッシュから削除
  delete taskCache[id];

  const now = new Date().toISOString();
  return { success: true, archived_at: now };
}

/**
 * タスク複製
 */
function duplicateTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const original = taskCache[id];
  assertMutableTask(original);

  const duplicated = addTask({
    title: original.title + '（コピー）',
    priority: original.priority,
    due_date: original.due_date,
    deadline_date: original.deadline_date,
    list: original.list,
    parent: original.parent,
    tags: [...(original.tags || [])]
  });

  return duplicated;
}

/**
 * タスク並び順一括更新（CHG-021）
 * payload: {
 *   ordered_ids: string[],
 *   field_updates?: { [taskId]: { due_date?, progress_status?, parent?, list? } }
 * }
 */
function reorderTasks(payload = {}) {
  const orderedIdsInput = Array.isArray(payload.ordered_ids) ? payload.ordered_ids : [];
  const fieldUpdates = payload.field_updates && typeof payload.field_updates === 'object'
    ? payload.field_updates
    : {};

  if (orderedIdsInput.length === 0) {
    throw new Error('ordered_ids is required');
  }

  const now = new Date().toISOString();
  const activeTasks = Object.values(taskCache)
    .filter((t) => t.delete_flag === 0 && !t.is_invalid)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const activeIds = activeTasks.map((t) => t.id);

  const dedupedOrderedIds = Array.from(new Set(orderedIdsInput.filter((id) => activeIds.includes(id))));
  const missingIds = activeIds.filter((id) => !dedupedOrderedIds.includes(id));
  const finalIds = [...dedupedOrderedIds, ...missingIds];

  const changedIds = new Set();
  const touchedParentIds = new Set();

  Object.entries(fieldUpdates).forEach(([taskId, patch]) => {
    const task = taskCache[taskId];
    if (!task || task.delete_flag === 1) return;
    assertMutableTask(task);

    const nextPatch = { ...patch };
    const prevParent = task.parent || null;

    if (task.status === 'done' && nextPatch.progress_status && nextPatch.progress_status !== '完了') {
      throw new Error(`Task ${taskId} is done and cannot change progress_status`);
    }

    if (Object.prototype.hasOwnProperty.call(nextPatch, 'due_date')) {
      task.due_date = nextPatch.due_date || null;
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'progress_status')) {
      task.progress_status = nextPatch.progress_status;
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'parent')) {
      const nextParent = nextPatch.parent || null;
      if (prevParent !== nextParent) {
        validateParentUpdate(taskId, nextParent);
        task.parent = nextParent;
        if (prevParent) touchedParentIds.add(prevParent);
        if (nextParent) touchedParentIds.add(nextParent);
      }
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'list')) {
      task.list = nextPatch.list || null;
    }

    if (task.status === 'done') {
      task.progress_status = '完了';
      task.completed_at = task.completed_at || now;
      ensureDueDateOnComplete(task);
    } else if (task.progress_status === '完了') {
      task.progress_status = '仕掛';
      task.completed_at = null;
    }

    task.updated_at = now;
    taskCache[taskId] = task;
    writeTaskFile(task);
    changedIds.add(taskId);
    if (task.parent) touchedParentIds.add(task.parent);
    if (prevParent) touchedParentIds.add(prevParent);
  });

  finalIds.forEach((taskId, idx) => {
    const task = taskCache[taskId];
    if (!task || task.delete_flag === 1) return;
    if (task.is_invalid) return;
    const nextOrder = idx + 1;
    if (task.sort_order !== nextOrder) {
      task.sort_order = nextOrder;
      task.updated_at = now;
      taskCache[taskId] = task;
      writeTaskFile(task);
      changedIds.add(taskId);
      if (task.parent) touchedParentIds.add(task.parent);
    }
  });

  touchedParentIds.forEach((parentId) => recomputeParentFromChildren(parentId, now));

  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);

  return {
    success: true,
    updated_count: changedIds.size,
    updated_at: now
  };
}

/**
 * キャッシュ再構築（watcher 経由で呼び出される）
 */
function rebuildCache() {
  try {
    loadAllTasksAndMigratePath();

    console.log(`[TaskService] Rebuilt cache: ${Object.keys(taskCache).length} tasks`);
    return { success: true, taskCount: Object.keys(taskCache).length };
  } catch (error) {
    console.error('[TaskService] Error rebuilding cache:', error);
    return { success: false, error: error.message };
  }
}

/**
 * キャッシュを返す（indexService 用）
 */
function getCache() {
  return taskCache;
}

function getTaskFileRoots() {
  return [...taskFileRoots];
}

function getTaskSearchRoots() {
  return taskFileRoots.map((root) => path.join(TASKS_DIR, normalizeRootPath(root || '.')));
}

function getTaskFilePath(id) {
  const task = taskCache[id];
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }
  return task._filePath || resolveTaskFilePath(null, id);
}

function getTaskBaseDir(id) {
  return path.dirname(getTaskFilePath(id));
}

/**
 * ファイルに書き込み
 */
function writeTaskFile(task) {
  const filePath = task._filePath || resolveTaskFilePath(null, task.id);
  ensureParentDir(filePath);
  task._filePath = filePath;
  delete task.task_file_path;

  // frontmatter 用オブジェクト（content は除く）
  const frontmatter = { ...task };
  delete frontmatter.content;
  delete frontmatter._filePath;
  delete frontmatter._needsLegacyPathCleanup;
  delete frontmatter.is_manual_progress;
  delete frontmatter.task_file_path;
  delete frontmatter.progress;

  // gray-matter で frontmatter + content を生成
  const markdown = matter.stringify(task.content || '', frontmatter);

  fs.writeFileSync(filePath, markdown, 'utf-8');
}

module.exports = {
  openTaskService,
  getAllTasks,
  getCompletedTasks,
  getCompletedTaskPage,
  getTrashedTasks,
  getTaskById,
  getTasksByList,
  getTasksByParent,
  searchTasks,
  addTask,
  updateTask,
  updateTaskContent,
  updateTaskTags,
  completeTask,
  reopenTask,
  trashTask,
  restoreTask,
  deleteTask,
  duplicateTask,
  reorderTasks,
  applyFileChange,
  rebuildCache,
  getCache,
  getIndexTasksForRebuild,
  getTaskFileRoots,
  getTaskSearchRoots,
  getTaskFilePath,
  getTaskBaseDir
};
