const DEFAULT_MAX_DEPTH = 5;

function normalizeProgressStatus(task) {
  return task.progress_status || (task.status === 'done' ? '完了' : '未着');
}

function getTaskDepth(cache, taskId, maxDepth = DEFAULT_MAX_DEPTH, seen = new Set()) {
  const task = cache[taskId];
  if (!task || !task.parent) return 1;
  if (seen.has(taskId)) return maxDepth + 1;
  const nextSeen = new Set(seen);
  nextSeen.add(taskId);
  return getTaskDepth(cache, task.parent, maxDepth, nextSeen) + 1;
}

function getTaskSubtreeDepth(cache, taskId, maxDepth = DEFAULT_MAX_DEPTH, seen = new Set()) {
  if (!taskId || seen.has(taskId)) return maxDepth + 1;
  const task = cache[taskId];
  if (!task || task.delete_flag === 1 || task.is_invalid) return 1;
  const nextSeen = new Set(seen);
  nextSeen.add(taskId);
  const children = Object.values(cache)
    .filter((child) => child.parent === taskId && child.delete_flag === 0 && !child.is_invalid);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => getTaskSubtreeDepth(cache, child.id, maxDepth, nextSeen)));
}

function validateParentUpdate(cache, taskId, nextParentId, maxDepth = DEFAULT_MAX_DEPTH) {
  if (!nextParentId) return;
  if (taskId === nextParentId) throw new Error('自分自身を親タスクにはできません。');

  const parent = cache[nextParentId];
  if (!parent || parent.delete_flag === 1 || parent.is_invalid) {
    throw new Error('指定された親タスクが見つかりません。');
  }

  let currentParentId = nextParentId;
  const seen = new Set();
  while (currentParentId) {
    if (currentParentId === taskId) throw new Error('子孫タスクを親にすると循環参照になります。');
    if (seen.has(currentParentId)) throw new Error('親子関係に循環参照があります。');
    seen.add(currentParentId);
    currentParentId = cache[currentParentId]?.parent || null;
  }

  if (getTaskDepth(cache, nextParentId, maxDepth) + getTaskSubtreeDepth(cache, taskId, maxDepth) > maxDepth) {
    throw new Error(`タスク階層は最大${maxDepth}階層までです。`);
  }
}

function collectDescendantTasks(cache, parentId, maxDepth = DEFAULT_MAX_DEPTH) {
  const descendants = [];
  const walk = (currentParentId, depth, seen = new Set()) => {
    if (depth >= maxDepth || seen.has(currentParentId)) return;
    const nextSeen = new Set(seen);
    nextSeen.add(currentParentId);
    Object.values(cache).forEach((child) => {
      if (child.parent !== currentParentId || child.delete_flag === 1 || child.is_invalid) return;
      descendants.push(child);
      walk(child.id, depth + 1, nextSeen);
    });
  };
  walk(parentId, 1);
  return descendants;
}

function estimateParentState(parent, children) {
  if (normalizeProgressStatus(parent) !== '未着') return null;
  const statuses = children.map(normalizeProgressStatus);
  return statuses.some((status) => status === '仕掛' || status === '完了')
    ? { progress_status: '仕掛', status: 'todo' }
    : null;
}

module.exports = {
  normalizeProgressStatus,
  getTaskDepth,
  validateParentUpdate,
  collectDescendantTasks,
  estimateParentState,
};
