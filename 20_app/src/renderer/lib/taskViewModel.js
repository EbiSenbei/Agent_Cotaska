const MAX_TASK_TREE_DEPTH = 5;
// ── Markdownファイル → UI オブジェクトの変換 ────────────────────────────────────
function formatDue(due_date) {
  if (!due_date) return "";

  const raw = String(due_date).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (!match) return raw;

  const [, , m, d, hhmm] = match;
  const base = `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  return hhmm ? `${base} ${hhmm}` : base;
}

function dueDatePart(due_date) {
  if (!due_date) return null;
  const raw = String(due_date).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function dueDateSortValue(due_date) {
  if (!due_date) return null;
  const raw = String(due_date).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (!match) return null;
  return `${match[1]}T${match[2] || "00:00"}`;
}

function normalizeProgressStatusValue(progressStatus, status = "todo") {
  const value = String(progressStatus || "").trim();
  if (value === "未着手") return "未着";
  if (value === "未着" || value === "仕掛" || value === "保留" || value === "完了") return value;
  return status === "done" ? "完了" : (value || "未着");
}

function isOnHoldTask(task) {
  return normalizeProgressStatusValue(task?.progressStatus, task?.status) === "保留";
}

function isActiveDateTask(task) {
  return task?.status !== "done" && !isOnHoldTask(task);
}

// T-031: frontmatterフィールドに対応（file-first architecture）
function mapFileTask(taskData) {
  const today = localDateString();
  const progressStatus = normalizeProgressStatusValue(taskData.progress_status, taskData.status);
  const task = {
    id:        taskData.id,
    title:     taskData.title,
    content:   taskData.content || "",
    status:    taskData.status,
    progressStatus,
    priority:  taskData.priority || "normal",
    parent:    taskData.parent ?? null,           // parent_idではなくparent
    list:      taskData.list ?? null,             // list_idではなくlist（文字列）
    tags:      taskData.tags || [],               // frontmatterの新フィールド
    sort_order: taskData.sort_order ?? 0,
    created_at: taskData.created_at || null,
    completed_at: taskData.completed_at || null,
    due_date:  taskData.due_date || null,
    due:       formatDue(taskData.due_date),
    deadline_date: taskData.deadline_date || null,
    deadline:  formatDue(taskData.deadline_date),
    overdue:   taskData.due_date ? dueDatePart(taskData.due_date) < today && taskData.status !== "done" : false,
    deadlineOverdue: taskData.deadline_date ? dueDatePart(taskData.deadline_date) < today && taskData.status !== "done" : false,
    is_invalid: Boolean(taskData.is_invalid),
    validation_error: taskData.validation_error || "",
    validation_error_name: taskData.validation_error_name || "",
    validation_error_line: taskData.validation_error_line ?? null,
    validation_error_column: taskData.validation_error_column ?? null,
    validation_file_path: taskData.validation_file_path || null,
  };

  task.searchText = buildSearchText(task);
  return task;
}

function calcParentProgress(parent, subtasks) {
  const parentStatus = normalizeProgressStatusValue(parent.progressStatus, parent.status);
  if (parentStatus !== "未着") return null;

  const statuses = subtasks.map((t) => normalizeProgressStatusValue(t.progressStatus, t.status));
  if (statuses.some((status) => status === "仕掛" || status === "完了")) return "仕掛";
  if (statuses.some((status) => status === "保留")) return "保留";
  return null;
}

// T-031: frontmatter形式でのペイロード作成
function toFileTaskPayload(task, patch = {}) {
  return {
    id: task.id,
    title: task.title,
    content: task.content || "",
    status: task.status,
    progress_status: task.progressStatus || (task.status === "done" ? "完了" : "未着"),
    priority: task.priority || "normal",
    parent: task.parent ?? null,         // parent_idではなくparent
    list: task.list ?? null,             // list_idではなくlist（文字列）
    tags: task.tags || [],
    due_date: task.due_date || null,
    deadline_date: task.deadline_date || null,
    ...patch,
  };
}

function enrichTaskHierarchy(taskList) {
  const byId = new Map(taskList.map((task) => [task.id, task]));
  const memo = new Map();

  const resolve = (task, trail = new Set()) => {
    if (!task?.id) return { depth: 1, overLimit: false, parentMissing: false, cycle: false };
    if (memo.has(task.id)) return memo.get(task.id);

    const parentId = task.parent;
    if (parentId === null || parentId === undefined || parentId === "") {
      const rootMeta = { depth: 1, overLimit: false, parentMissing: false, cycle: false };
      memo.set(task.id, rootMeta);
      return rootMeta;
    }

    const parent = byId.get(parentId);
    if (!parent) {
      const missingMeta = { depth: 1, overLimit: false, parentMissing: true, cycle: false };
      memo.set(task.id, missingMeta);
      return missingMeta;
    }

    if (trail.has(task.id)) {
      const cycleMeta = { depth: 1, overLimit: true, parentMissing: false, cycle: true };
      memo.set(task.id, cycleMeta);
      return cycleMeta;
    }

    trail.add(task.id);
    const parentMeta = resolve(parent, trail);
    trail.delete(task.id);

    const depth = parentMeta.depth + 1;
    const meta = {
      depth,
      overLimit: parentMeta.overLimit || depth > MAX_TASK_TREE_DEPTH,
      parentMissing: parentMeta.parentMissing,
      cycle: parentMeta.cycle,
    };
    memo.set(task.id, meta);
    return meta;
  };

  return taskList.map((task) => {
    const meta = resolve(task);
    const warning = meta.cycle
      ? "階層の循環参照があります"
      : meta.overLimit
        ? `階層上限を超えています（${meta.depth}階層目）`
        : meta.parentMissing
          ? "親タスクが見つかりません"
          : "";

    return {
      ...task,
      hierarchyDepth: meta.depth,
      hierarchyOverLimit: meta.overLimit,
      hierarchyParentMissing: meta.parentMissing,
      hierarchyCycle: meta.cycle,
      hierarchyWarning: warning,
    };
  });
}

function collectDescendantTasks(taskList, parentId, maxDepth = MAX_TASK_TREE_DEPTH) {
  const byParent = {};
  taskList.forEach((task) => {
    if (!task.parent) return;
    if (!byParent[task.parent]) byParent[task.parent] = [];
    byParent[task.parent].push(task);
  });

  const descendants = [];
  const walk = (currentParentId, depth, seen = new Set()) => {
    if (depth > maxDepth || seen.has(currentParentId)) return;
    seen.add(currentParentId);
    (byParent[currentParentId] || []).forEach((child) => {
      if (child.hierarchyOverLimit || child.hierarchyCycle) return;
      descendants.push(child);
      walk(child.id, depth + 1, new Set(seen));
    });
  };

  walk(parentId, 1);
  return descendants;
}
// ─────────────────────────────────────────────────────────────────

// ── ビュー別セクション構築ユーティリティ ────────────────────────────────
const PRIORITY_ORDER = { high: 0, medium: 1, normal: 2 };

// BUG-20260319-01 修正: ローカルタイムゾーン基準で日付文字列を返す
function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(base, n) {
  const d = new Date(base + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateString(d);  // toISOString() はUTC変換でタイムゾーンがずれるため使用しない
}

function sortByPriority(arr) {
  return [...arr].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );
}

function sortByTaskOrder(arr) {
  return [...arr].sort((a, b) =>
    (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id))
  );
}

function compareTaskId(a, b) {
  return String(a.id || "").localeCompare(String(b.id || ""), "ja", { numeric: true });
}

function sortDisplayTasks(arr, sortState) {
  const { key = "id", direction = "asc" } = sortState || {};
  if (key === "order") return sortByTaskOrder(arr);

  const dir = direction === "desc" ? -1 : 1;

  return [...arr].sort((a, b) => {
    let result = 0;
    if (key === "date") {
      const aDate = dueDateSortValue(a.due_date);
      const bDate = dueDateSortValue(b.due_date);
      if (!aDate && !bDate) result = 0;
      else if (!aDate) result = 1;
      else if (!bDate) result = -1;
      else result = aDate.localeCompare(bDate) * dir;
    } else if (key === "title") {
      result = String(a.title || "").localeCompare(String(b.title || ""), "ja", { numeric: true }) * dir;
    } else {
      result = compareTaskId(a, b) * dir;
    }
    return result || compareTaskId(a, b);
  });
}

function normalizeSearchInput(value) {
  return String(value || "").trim().toLowerCase();
}

function buildSearchableValues(task) {
  const tags = task.tags || [];
  return [
    task.id,
    task.title,
    task.content,
    task.list,
    task.priority,
    task.progressStatus,
    task.due_date,
    dueDatePart(task.due_date),
    formatDue(task.due_date),
    ...tags,
    ...tags.map((tag) => `#${tag}`),
  ].map(normalizeSearchInput).filter(Boolean);
}

function buildSearchText(task) {
  return buildSearchableValues(task).join("\n");
}

function taskMatchesSearch(task, keyword) {
  const keywords = normalizeSearchInput(keyword).split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return false;

  const searchable = task.searchText || buildSearchText(task);
  return keywords.every((kw) => searchable.includes(kw));
}

const FIXED_VIEWS = new Set(["すべて", "今日", "明日", "次の7日間", "仕掛", "保留", "完了", "ゴミ箱", "受信トレイ", "リストなし"]);

/**
 * 今日 / 次の7日間ビューでセクション配列を返す。它以外は null。
 * @returns {{ label: string, tasks: object[] }[] | null}
 */
function buildSections(allTasks, view) {
  const today = localDateString();
  if (view === "今日") {
    const filtered = allTasks.filter(
      (t) => dueDatePart(t.due_date) && dueDatePart(t.due_date) <= today && isActiveDateTask(t)
    );
    const sections = [];
    const overdue    = sortByTaskOrder(filtered.filter((t) => dueDatePart(t.due_date) < today));
    const todayTasks = sortByTaskOrder(filtered.filter((t) => dueDatePart(t.due_date) === today));
    if (overdue.length)    sections.push({ label: "⚠️ 遅延", tasks: overdue });
    if (todayTasks.length) sections.push({ label: "☀️ 今日",   tasks: todayTasks });
    return sections;
  }
  if (view === "次の7日間") {
    const today7 = addDays(today, 7);
    const day1   = addDays(today, 1);
    const day2   = addDays(today, 2);
    const filtered = allTasks.filter(
      (t) => dueDatePart(t.due_date) && dueDatePart(t.due_date) <= today7 && isActiveDateTask(t)
    );
    
    const sections  = [];
    const overdue    = sortByTaskOrder(filtered.filter((t) => dueDatePart(t.due_date) <  today));
    const todayTasks = sortByTaskOrder(filtered.filter((t) => dueDatePart(t.due_date) === today));
    const tomorrows  = sortByTaskOrder(filtered.filter((t) => dueDatePart(t.due_date) === day1));
    const later      = sortByTaskOrder(filtered.filter((t) => dueDatePart(t.due_date) >= day2 && dueDatePart(t.due_date) <= today7));
    if (overdue.length)    sections.push({ label: "⚠️ 遅延",   tasks: overdue });
    if (todayTasks.length) sections.push({ label: "☀️ 今日",   tasks: todayTasks });
    if (tomorrows.length)  sections.push({ label: "📅 明日",   tasks: tomorrows });
    if (later.length)      sections.push({ label: "📆 以降",   tasks: later });
    return sections;
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────

export {
  MAX_TASK_TREE_DEPTH,
  formatDue,
  dueDatePart,
  dueDateSortValue,
  normalizeProgressStatusValue,
  isOnHoldTask,
  isActiveDateTask,
  mapFileTask,
  calcParentProgress,
  toFileTaskPayload,
  enrichTaskHierarchy,
  collectDescendantTasks,
  localDateString,
  addDays,
  sortByPriority,
  sortByTaskOrder,
  sortDisplayTasks,
  taskMatchesSearch,
  FIXED_VIEWS,
  buildSections,
};
