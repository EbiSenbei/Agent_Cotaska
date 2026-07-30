import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";
import "./styles/ai-chat.css";
import "./styles/app-components.css";
import Sidebar    from "./components/Sidebar";
import NavPanel   from "./components/NavPanel";
import MainPane   from "./components/MainPane";
import DetailPane from "./components/DetailPane";
import SettingsPane from "./components/SettingsPane";
import AiChatPane from "./components/AiChatPane";
import { useExitPresence } from "./hooks/useExitPresence";
import {
  MAX_TASK_TREE_DEPTH,
  addDays,
  buildSections,
  calcParentProgress,
  collectDescendantTasks,
  dueDatePart,
  enrichTaskHierarchy,
  FIXED_VIEWS,
  localDateString,
  mapFileTask,
  normalizeProgressStatusValue,
  isOnHoldTask,
  isActiveDateTask,
  sortByTaskOrder,
  sortDisplayTasks,
  toFileTaskPayload,
} from "./lib/taskViewModel";

const TAG_NAV_PREFIX = "tag:";
const DATE_VIEWS_WITH_ON_HOLD_SECTION = new Set(["今日", "明日", "次の7日間"]);
const DETAIL_PANE_MIN_WIDTH = 320;
const DETAIL_PANE_MAX_WIDTH = 720;
const DETAIL_PANE_DEFAULT_WIDTH = 380;
const STARTUP_INITIAL_VIEWS = new Set(["すべて", "今日", "明日", "次の7日間"]);

function normalizeStartupInitialView(value) {
  const view = String(value || "").trim();
  return STARTUP_INITIAL_VIEWS.has(view) ? view : "今日";
}

function getOnHoldTasksForDateView(tasks, view, sortState) {
  const today = localDateString();
  const cutoffDate = view === "明日"
    ? addDays(today, 1)
    : view === "次の7日間"
      ? addDays(today, 7)
      : today;

  return sortDisplayTasks(
    tasks.filter((t) => {
      const date = dueDatePart(t.due_date);
      return date && date <= cutoffDate && t.status !== "done" && isOnHoldTask(t);
    }),
    sortState
  );
}

function App() {
  const [tasks,         setTasks]         = useState([]);
  const [selectedTask,  setSelectedTask]  = useState(null);
  const [activeNav,     setActiveNav]     = useState("今日");
  const [activeIcon,    setActiveIcon]    = useState("リスト");
  const [loading,       setLoading]       = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [startupError, setStartupError] = useState(null);
  const [startupProgress, setStartupProgress] = useState({
    percent: 0,
    label: "起動を開始しています...",
    detail: "Cotaska の準備を始めています。",
  });
  const [allCount,      setAllCount]      = useState(0);
  const [todayCount,    setTodayCount]    = useState(0);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [next7DaysCount, setNext7DaysCount] = useState(0);
  const [noListCount,   setNoListCount]   = useState(0);
  const [lists,         setLists]         = useState([]);
  const [trashedTasks,   setTrashedTasks]   = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [completedLimit, setCompletedLimit] = useState(100);
  const [completedHasMore, setCompletedHasMore] = useState(false);
  const [searchKeyword,  setSearchKeyword]  = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchSort, setSearchSort] = useState({ key: "id", direction: "asc" });
  const [listSort, setListSort] = useState({ key: "order", direction: "asc" });
  const [tags, setTags] = useState([]);
  const [trashConfirm, setTrashConfirm] = useState(null);
  const trashConfirmPresence = useExitPresence(trashConfirm);
  const [updateAlert, setUpdateAlert] = useState({
    hasUpdate: false,
    message: "",
    latestVersion: "",
  });
  const [aiTaskChatRequest, setAiTaskChatRequest] = useState(null);
  const [aiThreadOpenRequest, setAiThreadOpenRequest] = useState(null);
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(null);
  const startupUpdateCheckRef = useRef(false);
  const startupInitialViewAppliedRef = useRef(false);
  const isSearchMode = activeIcon === "検索";

  useEffect(() => {
    if (!trashConfirm) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setTrashConfirm(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [trashConfirm]);

  // CHG-032: ペイン幅リサイズ
  const [navWidth,    setNavWidth]    = useState(240);
  const [detailWidth, setDetailWidth] = useState(() => {
    const saved = Number(window.localStorage?.getItem("cotaska.detailPaneWidth"));
    if (!Number.isFinite(saved)) return DETAIL_PANE_DEFAULT_WIDTH;
    return Math.max(DETAIL_PANE_MIN_WIDTH, Math.min(DETAIL_PANE_MAX_WIDTH, saved));
  });
  const [detailPaneExpanded, setDetailPaneExpanded] = useState(false);
  const [paneResizeType, setPaneResizeType] = useState(null);
  const resizeDragRef = useRef(null);

  // T-005-02: DB からタスク一覧を読み込む
  // T-031: tasks:changed イベントリスナー登録（リアルタイム同期）
  useEffect(() => {
    let cancelled = false;
    window.cotaskaAPI?.startup?.getProgress?.().then((progress) => {
      if (!cancelled && progress) setStartupProgress(progress);
    });
    const removeStartupProgressListener = window.cotaskaAPI?.startup?.onProgress?.((progress) => {
      if (progress) setStartupProgress(progress);
    });
    return () => {
      cancelled = true;
      removeStartupProgressListener?.();
    };
  }, []);

  useEffect(() => window.cotaskaAPI?.aiChat?.onOpenThread?.((payload) => {
    const threadId = String(payload?.thread_id || "").trim();
    if (!threadId) return;
    setDetailPaneExpanded(false);
    setActiveIcon("AI");
    setAiThreadOpenRequest({ threadId, requestedAt: Date.now() });
  }), []);

  // CHG-032: ペイン幅ドラッグリサイズ
  useEffect(() => {
    const onMove = (e) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      if (drag.type === "nav") {
        setNavWidth(Math.max(160, Math.min(480, drag.startWidth + delta)));
      } else {
        setDetailWidth(Math.max(DETAIL_PANE_MIN_WIDTH, Math.min(DETAIL_PANE_MAX_WIDTH, drag.startWidth - delta)));
      }
    };
    const finishResize = () => {
      resizeDragRef.current = null;
      setPaneResizeType(null);
      document.body.classList.remove("is-resizing-app-panes");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finishResize);
    window.addEventListener("blur", finishResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finishResize);
      window.removeEventListener("blur", finishResize);
      document.body.classList.remove("is-resizing-app-panes");
    };
  }, []);

  useEffect(() => {
    window.localStorage?.setItem("cotaska.detailPaneWidth", String(detailWidth));
  }, [detailWidth]);

  useEffect(() => {
    if (!selectedTask) setDetailPaneExpanded(false);
  }, [selectedTask]);

  const loadTasks = useCallback(async (options = {}) => {
    const shouldShowLoading = Boolean(options.showLoading);
    const providedRows = Array.isArray(options.rows) ? options.rows : null;
    if (shouldShowLoading) setLoading(true);
    setStartupError(null);
    let loaded = false;
    try {
      if (shouldShowLoading) {
        setStartupProgress({
          percent: 90,
          label: "タスク一覧を取得しています...",
          detail: "初回表示用のタスクデータを受け取っています。",
        });
      }
      const settingsResult = await window.cotaskaAPI?.settings?.get?.();
      const initialCompletedLimit = Number(settingsResult?.settings?.taskLoading?.completedInitialLimit);
      if (Number.isFinite(initialCompletedLimit)) setCompletedLimit(initialCompletedLimit);
      if (shouldShowLoading && !startupInitialViewAppliedRef.current) {
        setActiveNav(normalizeStartupInitialView(settingsResult?.settings?.startup?.initialView));
        startupInitialViewAppliedRef.current = true;
      }
      let rows = providedRows ?? await window.cotaskaAPI?.tasks?.getAll() ?? [];
      if (shouldShowLoading) {
        setStartupProgress({
          percent: 96,
          label: "画面を組み立てています...",
          detail: "タスクの階層と件数を計算しています。",
        });
      }
      let mapped = enrichTaskHierarchy(rows.map(mapFileTask));

      // T-015-03: 親が未着の場合だけ、子タスク状態から進捗を自動開始する。
      const byParent = {};
      mapped.forEach((task) => {
        const pid = task.parent;
        if (pid === null || pid === undefined) return;
        if (!byParent[pid]) byParent[pid] = [];
        byParent[pid].push(task);
      });

      let parentStatusUpdated = false;
      for (const parent of mapped) {
        const children = byParent[parent.id] || [];
        if (children.length === 0) continue;
        const estimated = calcParentProgress(parent, children);
        if (!estimated) continue;
        const estimatedTaskStatus = estimated === "完了" ? "done" : "todo";
        if (parent.progressStatus !== estimated || parent.status !== estimatedTaskStatus) {
          await window.cotaskaAPI?.tasks?.update(
            toFileTaskPayload(parent, {
              progress_status: estimated,
              status: estimatedTaskStatus,
            })
          );
          parentStatusUpdated = true;
        }
      }

      if (parentStatusUpdated) {
        rows = await window.cotaskaAPI?.tasks?.getAll() ?? [];
        mapped = enrichTaskHierarchy(rows.map(mapFileTask));
      }

      setTasks(sortByTaskOrder(mapped));

      // 固定ビューのバッジ件数
      const today = localDateString();
      const tomorrow = addDays(today, 1);
      const next7 = addDays(today, 7);
      setAllCount(mapped.filter((t) => t.status !== "done").length);
      setTodayCount(mapped.filter((t) => dueDatePart(t.due_date) && dueDatePart(t.due_date) <= today && isActiveDateTask(t)).length);
      setTomorrowCount(mapped.filter((t) => dueDatePart(t.due_date) === tomorrow && isActiveDateTask(t)).length);
      setNext7DaysCount(mapped.filter((t) => dueDatePart(t.due_date) && dueDatePart(t.due_date) <= next7 && isActiveDateTask(t)).length);
      setNoListCount(mapped.filter((t) => (t.list === null || t.list === undefined) && t.status !== "done").length);

      // 選択中タスクがまだ存在する場合は最新データで上書き
      setSelectedTask(prev =>
        prev ? (mapped.find(t => t.id === prev.id) ?? null) : null
      );
      loaded = true;
      if (shouldShowLoading) {
        setStartupProgress({
          percent: 100,
          label: "準備ができました",
          detail: "Cotaska を表示します。",
        });
      }
    } catch (err) {
      console.error("[loadTasks]", err);
      setStartupError("タスクの読み込みに失敗しました。アプリを再起動してください。");
    } finally {
      if (shouldShowLoading) setLoading(false);
      if (loaded) setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleTasksChanged = (data) => {
      console.log('[App] tasks:changed event received', data);
      loadTasks({ rows: data?.tasks });
    };
    window.cotaskaAPI?.onTasksChanged?.(handleTasksChanged);
    return () => {
      // アンマウント時にリスナーを削除
      window.cotaskaAPI?.removeTasksChangedListener?.();
    };
  }, [loadTasks]);

  const loadTags = useCallback(async () => {
    const rows = await window.cotaskaAPI?.tags?.getAll() ?? [];
    setTags(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    // IPC 疎通確認
    window.cotaskaAPI?.ping().then(res => console.log("[IPC] ping →", res));
    loadTasks({ showLoading: true }); // ← 他の useEffect に移動しました
    // リスト一覧を起動時に取得
    (async () => {
      const rows = await window.cotaskaAPI?.lists?.getAll() ?? [];
      setLists(rows);
      const tagRows = await window.cotaskaAPI?.tags?.getAll() ?? [];
      setTags(Array.isArray(tagRows) ? tagRows : []);
    })();
  }, [loadTasks]);

  useEffect(() => {
    let cancelled = false;
    const applyUpdateStatus = (status) => {
      if (!status || cancelled) return;
      setUpdateAlert({
        hasUpdate: Boolean(status.hasUpdate),
        message: status.message || "",
        latestVersion: status.latestVersion || status.version || "",
      });
    };

    window.cotaskaAPI?.updates?.getStatus?.().then(applyUpdateStatus);
    const unsubscribe = window.cotaskaAPI?.updates?.onStatus?.(applyUpdateStatus);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (initialLoading || startupUpdateCheckRef.current) return;
    startupUpdateCheckRef.current = true;
    (async () => {
      try {
        const result = await window.cotaskaAPI?.updates?.check?.();
        if (result?.hasUpdate) {
          setUpdateAlert({
            hasUpdate: true,
            message: result.message || "新しいバージョンがあります。",
            latestVersion: result.latestVersion || result.version || "",
          });
        }
      } catch (err) {
        console.warn("[updates] startup check failed", err);
      }
    })();
  }, [initialLoading]);

  // T-005-03: クイック追加
  // BUG-20260317-01 修正: 「今日」「次の7日間」ビューでは due_date=null のタスクが
  // buildSections のフィルタで除外されるため、当日日付を自動設定する
  const handleAddTask = useCallback(async (quickAddInput) => {
    const payload = typeof quickAddInput === "string"
      ? { title: quickAddInput }
      : (quickAddInput || {});
    const title = String(payload.title || "").trim();
    if (!title) return;
    const today = localDateString();
    const tomorrow = addDays(today, 1);
    const defaultDueDate = activeNav === "明日"
      ? tomorrow
      : (activeNav === "今日" || activeNav === "次の7日間")
        ? today
        : null;
    const due_date = payload.due_date || defaultDueDate;
    // T-031: list_id ではなく list（文字列）を使用
    const defaultList = FIXED_VIEWS.has(activeNav) || activeNav.startsWith(TAG_NAV_PREFIX) ? null : activeNav;
    const list = payload.list || defaultList;
    const defaultTags = activeNav.startsWith(TAG_NAV_PREFIX) ? [activeNav.slice(TAG_NAV_PREFIX.length)] : [];
    const createdTask = await window.cotaskaAPI?.tasks?.add({
      title,
      status:   "todo",
      progress_status: "未着",
      priority: payload.priority || "normal",
      due_date,
      list,  // list_id ではなく list（リスト名）
      tags: [...new Set([...defaultTags, ...(payload.tags || [])])],
    });
    if (!createdTask?.id) {
      throw new Error(createdTask?.error || "タスクの登録に失敗しました。");
    }
    await loadTasks();
    // 登録直後は別ウィンドウではなく、メイン画面右側の詳細ペインで表示する。
    setSelectedTask(mapFileTask(createdTask));
    return createdTask;
  }, [loadTasks, activeNav]);

  // T-014-02: サブタスク追加
  const handleAddSubtask = useCallback(async (parentTask, title) => {
    if (!title.trim()) return;
    if (parentTask.hierarchyOverLimit || (parentTask.hierarchyDepth || 1) >= MAX_TASK_TREE_DEPTH) return;
    await window.cotaskaAPI?.tasks?.add({
      title:     title.trim(),
      status:    "todo",
      progress_status: "未着",
      priority:  "normal",
      parent:    parentTask.id,      // parent_id ではなく parent
      list:      parentTask.list,     // list_id ではなく list
      due_date:  parentTask.due_date || null,
    });
    await loadTasks();
  }, [loadTasks]);

  // T-005-04: 完了 / 完了取消
  const refreshSearchResults = useCallback(async (keyword = searchKeyword) => {
    const normalizedKeyword = String(keyword || "").trim();
    if (!isSearchMode || !normalizedKeyword) {
      setSearchResults([]);
      return;
    }
    const rows = await window.cotaskaAPI?.tasks?.search?.(normalizedKeyword) ?? [];
    setSearchResults(enrichTaskHierarchy(rows.map(mapFileTask)));
  }, [isSearchMode, searchKeyword]);

  const handleToggleComplete = useCallback(async (task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    const newProgressStatus = newStatus === "done" ? "完了" : "仕掛";
    await window.cotaskaAPI?.tasks?.update(
      toFileTaskPayload(task, {
        status: newStatus,
        progress_status: newProgressStatus,
      })
    );

    // CHG-009: 親タスク完了時はサブタスクも自動完了（カスケード）
    if (newStatus === "done") {
      const descendants = collectDescendantTasks(tasks, task.id)
        .filter((child) => child.status !== "done");
      for (const child of descendants) {
        await window.cotaskaAPI?.tasks?.update(
          toFileTaskPayload(child, {
            status: "done",
            progress_status: "完了",
          })
        );
      }
    }

    await loadTasks();
    await refreshSearchResults();
  }, [loadTasks, refreshSearchResults, tasks]);

  // T-005-05: 詳細ペイン保存後にリスト再取得
  const handleSaved = useCallback(async () => {
    await loadTasks();
    await refreshSearchResults();
  }, [loadTasks, refreshSearchResults]);

  // T-014-03: タスク複製
  const handleDuplicateTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.add({
      title:     `${task.title}（コピー）`,
      content:   task.content || "",
      status:    "todo",
      progress_status: "未着",
      priority:  task.priority || "normal",
      parent:    task.parent ?? null,
      list:      task.list ?? null,
      due_date:  task.due_date || null,
    });
    await loadTasks();
  }, [loadTasks]);

  // T-014-03: リスト設定
  const handleSetTaskList = useCallback(async (task, newList) => {
    await window.cotaskaAPI?.tasks?.update(toFileTaskPayload(task, { list: newList }));
    await loadTasks();
    await refreshSearchResults();
  }, [loadTasks, refreshSearchResults]);

  const handleSetTaskDue = useCallback(async (task, dueDate) => {
    await window.cotaskaAPI?.tasks?.update(
      toFileTaskPayload(task, { due_date: dueDate || null })
    );
    await loadTasks();
    await refreshSearchResults();
  }, [loadTasks, refreshSearchResults]);

  const getSubtreeDepth = useCallback((taskId, seen = new Set()) => {
    if (!taskId || seen.has(taskId)) return 0;
    const nextSeen = new Set(seen);
    nextSeen.add(taskId);
    const children = tasks.filter((task) => task.parent === taskId && !task.is_invalid);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((child) => getSubtreeDepth(child.id, nextSeen)));
  }, [tasks]);

  const canNestTask = useCallback((draggedTaskId, targetTaskId) => {
    if (!draggedTaskId || !targetTaskId || draggedTaskId === targetTaskId) return false;
    const dragged = tasks.find((task) => task.id === draggedTaskId);
    const target = tasks.find((task) => task.id === targetTaskId);
    if (!dragged || !target) return false;
    if (dragged.is_invalid || target.is_invalid) return false;
    if (dragged.status === "done" || target.status === "done") return false;
    if (dragged.hierarchyOverLimit || dragged.hierarchyCycle) return false;
    if (target.hierarchyOverLimit || target.hierarchyCycle) return false;
    if (collectDescendantTasks(tasks, draggedTaskId).some((child) => child.id === targetTaskId)) return false;

    const targetDepth = target.hierarchyDepth || 1;
    const subtreeDepth = getSubtreeDepth(draggedTaskId);
    return targetDepth + subtreeDepth <= MAX_TASK_TREE_DEPTH;
  }, [getSubtreeDepth, tasks]);

  const handleReorderTask = useCallback(async ({
    draggedTaskId,
    targetTaskId = null,
    toSectionType = null,
    toSectionLabel = null,
    mode = "after",
  }) => {
    const dragged = tasks.find((t) => t.id === draggedTaskId);
    if (!dragged) return;
    if (dragged.status === "done") return;

    const today = localDateString();
    const tomorrow = addDays(today, 1);
    const fieldUpdates = {};
    const target = targetTaskId ? tasks.find((t) => t.id === targetTaskId) : null;

    const logReorderDebug = (message, context = {}) => {
      window.cotaskaAPI?.debug?.log?.(`task-reorder:${message}`, context).catch?.(() => {});
    };

    if (toSectionType === "date") {
      if (String(toSectionLabel || "").includes("明日") && dueDatePart(dragged.due_date) !== tomorrow) {
        fieldUpdates[dragged.id] = { ...(fieldUpdates[dragged.id] || {}), due_date: tomorrow };
      }
      if (String(toSectionLabel || "").includes("今日") && dueDatePart(dragged.due_date) !== today) {
        fieldUpdates[dragged.id] = { ...(fieldUpdates[dragged.id] || {}), due_date: today };
      }
    }

    if (toSectionType === "progress") {
      if (dragged.status === "done") return;
      if (toSectionLabel === "完了" && dragged.progressStatus !== "完了") {
        fieldUpdates[dragged.id] = { ...(fieldUpdates[dragged.id] || {}), progress_status: "完了" };
      }
      // 「未着・仕掛」セクションへのドラッグは progress_status を変更しない
    }

    if (mode === "child") {
      if (!target || !canNestTask(draggedTaskId, targetTaskId)) return;
      fieldUpdates[dragged.id] = {
        ...(fieldUpdates[dragged.id] || {}),
        parent: targetTaskId,
        list: target.list ?? dragged.list ?? null,
      };
    } else if (mode === "root") {
      fieldUpdates[dragged.id] = {
        ...(fieldUpdates[dragged.id] || {}),
        parent: null,
      };
    } else if (target) {
      const descendants = collectDescendantTasks(tasks, draggedTaskId);
      if (descendants.some((child) => child.id === targetTaskId || child.id === target.parent)) return;
      fieldUpdates[dragged.id] = {
        ...(fieldUpdates[dragged.id] || {}),
        parent: target.parent ?? null,
        list: target.list ?? dragged.list ?? null,
      };
    }

    const reorderable = tasks
      .filter((t) => t.status !== "done")
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id)));

    const ids = reorderable.map((t) => t.id).filter((id) => id !== draggedTaskId);
    if (targetTaskId && ids.includes(targetTaskId)) {
      const targetIndex = ids.indexOf(targetTaskId);
      const insertAt = mode === "before" ? targetIndex : targetIndex + 1;
      ids.splice(insertAt, 0, draggedTaskId);
    } else {
      ids.push(draggedTaskId);
    }

    logReorderDebug("save-start", {
      draggedTaskId,
      targetTaskId,
      mode,
      field_updates: fieldUpdates,
    });
    const result = await window.cotaskaAPI?.tasks?.reorder({
      ordered_ids: ids,
      field_updates: fieldUpdates,
    });
    logReorderDebug("save-result", {
      draggedTaskId,
      targetTaskId,
      mode,
      result,
    });
    await loadTasks();
  }, [canNestTask, loadTasks, tasks]);

  // T-006: リスト操作
  const loadLists = useCallback(async () => {
    const rows = await window.cotaskaAPI?.lists?.getAll() ?? [];
    setLists(rows);
  }, []);

  const handleAddList = useCallback(async (name, color) => {
    await window.cotaskaAPI?.lists?.add({ name, color });
    await loadLists();
  }, [loadLists]);

  const handleUpdateList = useCallback(async (listName, updates) => {
    await window.cotaskaAPI?.lists?.update(listName, updates);
    await loadLists();
  }, [loadLists]);

  const handleDeleteList = useCallback(async (name) => {
    // T-031: list_id ではなく name（文字列）を渡す
    await window.cotaskaAPI?.lists?.delete(name);
    await loadLists();
    await loadTasks(); // 所属タスクの list を null に変更するため再取得
  }, [loadLists, loadTasks]);

  const handleAddTag = useCallback(async (name) => {
    await window.cotaskaAPI?.tags?.add(name);
    await loadTags();
  }, [loadTags]);

  const handleDeleteTag = useCallback(async (name) => {
    await window.cotaskaAPI?.tags?.delete(name);
    await loadTags();
    await loadTasks();
    if (activeNav === `${TAG_NAV_PREFIX}${name}`) {
      setActiveNav("今日");
    }
  }, [activeNav, loadTags, loadTasks]);

  const handleSetTaskTags = useCallback(async (task, nextTags) => {
    await window.cotaskaAPI?.taskTags?.set(task.id, nextTags);
    await loadTasks();
    await refreshSearchResults();
    await loadTags();
  }, [loadTasks, refreshSearchResults, loadTags]);

  const executeTrashTask = useCallback(async (task, descendants = [], directChildren = [], mode = "parent-only") => {
    const trashDescendants = mode === "all";

    if (trashDescendants) {
      for (const child of descendants) {
        await window.cotaskaAPI?.tasks?.trashTask(child.id);
      }
    } else {
      for (const child of directChildren) {
        await window.cotaskaAPI?.tasks?.update(
          toFileTaskPayload(child, { parent: null })
        );
      }
    }

    await window.cotaskaAPI?.tasks?.trashTask(task.id);
    if (
      selectedTask?.id === task.id ||
      (trashDescendants && descendants.some((child) => child.id === selectedTask?.id))
    ) {
      setSelectedTask(null);
    }
    await loadTasks();
  }, [loadTasks, selectedTask]);

  // T-005-06: ゴミ箱移動
  const handleTrashTask = useCallback(async (task) => {
    const descendants = collectDescendantTasks(tasks, task.id)
      .filter((child) => !child.is_invalid);
    const directChildren = tasks
      .filter((child) => child.parent === task.id && !child.is_invalid);

    if (descendants.length > 0) {
      setTrashConfirm({ task, descendants, directChildren });
      return;
    }

    await executeTrashTask(task, descendants, directChildren, "parent-only");
  }, [executeTrashTask, tasks]);

  // T-005-06: ゴミ箱内タスク一覧（activeNav === "ゴミ箱" のとき使用）
  useEffect(() => {
    if (activeNav !== "ゴミ箱") return;
    (async () => {
      const rows = await window.cotaskaAPI?.tasks?.getTrashed() ?? [];
      setTrashedTasks(enrichTaskHierarchy(rows.map(mapFileTask)));
    })();
  }, [activeNav, tasks]); // tasks 変化時も再取得

  // T-007-03: 完了ビュー
  useEffect(() => {
    if (activeNav !== "完了" && activeNav !== "すべて") return;
    (async () => {
      const settingsResult = await window.cotaskaAPI?.settings?.get?.();
      const initialCompletedLimit = Number(settingsResult?.settings?.taskLoading?.completedInitialLimit);
      if (Number.isFinite(initialCompletedLimit)) setCompletedLimit(initialCompletedLimit);
    })();
  }, [activeNav]);

  useEffect(() => {
    if (activeNav !== "完了" && activeNav !== "すべて") return;
    (async () => {
      const result = await window.cotaskaAPI?.tasks?.getCompletedPage?.({ limit: completedLimit });
      const rows = Array.isArray(result) ? result : (result?.tasks || []);
      setCompletedTasks(enrichTaskHierarchy(rows.map(mapFileTask)));
      setCompletedHasMore(Boolean(result?.hasMore));
    })();
  }, [activeNav, tasks, completedLimit]); // tasks 変化時も再取得

  const handleLoadMoreCompleted = useCallback(async () => {
    const settingsResult = await window.cotaskaAPI?.settings?.get?.();
    const increment = Number(settingsResult?.settings?.taskLoading?.completedLoadMoreLimit);
    setCompletedLimit((current) => current + (Number.isFinite(increment) ? increment : 100));
  }, []);

  // T-007-04: 検索モードを離れたときにキーワードをリセット
  useEffect(() => {
    if (!isSearchMode) setSearchKeyword("");
  }, [isSearchMode]);

  useEffect(() => {
    let cancelled = false;
    if (!isSearchMode || !searchKeyword.trim()) {
      setSearchResults([]);
      return () => { cancelled = true; };
    }
    (async () => {
      const rows = await window.cotaskaAPI?.tasks?.search?.(searchKeyword) ?? [];
      if (!cancelled) setSearchResults(enrichTaskHierarchy(rows.map(mapFileTask)));
    })();
    return () => { cancelled = true; };
  }, [isSearchMode, searchKeyword]);

  // T-005-06: 復元
  const handleRestoreTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.restoreTask(task.id);
    await loadTasks();
  }, [loadTasks]);

  // T-005-06: 完全削除
  const handleDeleteTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.deleteTask(task.id);
    await loadTasks();
  }, [loadTasks]);

  // T-004-05: サイドバーアイコンに応じてナビパネルの表示を制御
  const isSettingsMode = activeIcon === "設定";
  const isAiMode = activeIcon === "AI";
  const navVisible = activeIcon === "リスト";

  const handleSidebarIconClick = useCallback((icon) => {
    setActiveIcon(icon);
    if (icon === "リスト" || icon === "検索" || icon === "AI") {
      setDetailPaneExpanded(false);
    }
  }, []);

  const handleOpenTaskFromAi = useCallback((taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    setActiveIcon("リスト");
    setDetailPaneExpanded(false);
    setSelectedTask(task);
    if (task.status === "done") {
      setActiveNav("完了");
    } else if (task.list === null || task.list === undefined) {
      setActiveNav("リストなし");
    } else {
      setActiveNav(task.list);
    }
  }, [tasks]);

  useEffect(() => {
    const handleOpenSettings = (event) => {
      setActiveIcon("設定");
      setDetailPaneExpanded(false);
      setSettingsFocusRequest({
        target: event.detail?.target || "settings",
        requestedAt: Date.now(),
      });
    };
    window.addEventListener("cotaska:openSettings", handleOpenSettings);
    return () => window.removeEventListener("cotaska:openSettings", handleOpenSettings);
  }, []);

  const handleStartTaskAiChat = useCallback((task) => {
    if (!task?.id) return;
    setDetailPaneExpanded(false);
    setActiveIcon("AI");
    setAiTaskChatRequest({
      taskId: task.id,
      requestedAt: Date.now(),
    });
  }, []);

  useEffect(() => window.cotaskaAPI?.detailWindow?.onOpenAiChat?.((payload) => {
    handleStartTaskAiChat({ id: payload?.taskId });
  }), [handleStartTaskAiChat]);

  const handleTaskChatRequestProcessed = useCallback((requestedAt) => {
    setAiTaskChatRequest((current) => (
      current?.requestedAt === requestedAt ? null : current
    ));
  }, []);

  const tagCounts = useMemo(() => {
    const counts = {};
    tasks.forEach((task) => {
      (task.tags || []).forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return counts;
  }, [tasks]);

  // ビュー別タスクフィルタとセクション構築
  // T-031: list_id ではなく list（文字列）でフィルタ
  let visibleTasks;
  let visibleSections = null;
  let progressSections = null;

  if (isSearchMode) {
    // T-007-04: 検索モード — delete_flag=0 の全タスクをキーワードでフィルタ
    if (!searchKeyword.trim()) {
      visibleTasks = [];
    } else {
      visibleTasks = sortDisplayTasks(
        searchResults,
        searchSort
      );
    }
  } else if (activeNav === "ゴミ箱") {
    visibleTasks = trashedTasks;
  } else if (activeNav === "完了") {
    visibleTasks = completedTasks;
  } else if (loading) {
    visibleTasks = [];
  } else if (activeNav === "すべて") {
    visibleTasks = sortDisplayTasks(tasks.filter((t) => t.status !== "done"), listSort);
  } else if (activeNav === "仕掛") {
    visibleTasks = sortDisplayTasks(tasks.filter((t) => t.progressStatus === "仕掛" && t.status !== "done"), listSort);
  } else if (activeNav === "保留") {
    visibleTasks = sortDisplayTasks(tasks.filter((t) => isOnHoldTask(t) && t.status !== "done"), listSort);
  } else if (activeNav === "明日") {
    const tomorrow = addDays(localDateString(), 1);
    const dateTasks = sortDisplayTasks(
      tasks.filter((t) => dueDatePart(t.due_date) === tomorrow && isActiveDateTask(t)),
      listSort
    );
    const onHoldTasks = getOnHoldTasksForDateView(tasks, activeNav, listSort);
    visibleSections = dateTasks.length > 0 ? [{ label: "📅 明日", tasks: dateTasks }] : [];
    visibleTasks = [...dateTasks, ...onHoldTasks];
  } else if (activeNav === "今日" || activeNav === "次の7日間") {
    visibleSections = buildSections(tasks, activeNav);
    visibleSections = visibleSections.map((section) => ({
      ...section,
      tasks: sortDisplayTasks(section.tasks, listSort),
    }));
    const sectionTasks = visibleSections.flatMap((s) => s.tasks);
    const onHoldTasks = getOnHoldTasksForDateView(tasks, activeNav, listSort);
    visibleTasks = [...sectionTasks, ...onHoldTasks];
  } else if (activeNav === "受信トレイ" || activeNav === "リストなし") {
    // T-007-05: 完了済みタスクは完了ビューへ
    // T-031: list_id を list に変更
    visibleTasks = sortDisplayTasks(tasks.filter((t) =>
      (t.list === null || t.list === undefined) && t.status !== "done"
    ), listSort);
  } else {
    if (activeNav.startsWith(TAG_NAV_PREFIX)) {
      const activeTag = activeNav.slice(TAG_NAV_PREFIX.length);
      // CHG-011: 完了タスクは完了セクションへ移動するため status フィルタを追加
      visibleTasks = sortDisplayTasks(tasks.filter((t) => (t.tags || []).includes(activeTag) && t.status !== "done"), listSort);
    } else {
      // T-031: list_id ではなく list（文字列）でフィルタ
      // CHG-011: 完了タスクは完了セクションへ移動するため status フィルタを追加
      visibleTasks = sortDisplayTasks(tasks.filter((t) => t.list === activeNav && t.status !== "done"), listSort);
    }
  }

  // CHG-011: 完了セクション（各ビューのリスト下部に表示する完了タスク）
  let completedSectionTasks = [];
  if (!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" && !loading) {
    const today = localDateString();
    if (activeNav === "すべて") {
      completedSectionTasks = completedTasks;
    } else if (activeNav === "仕掛" || activeNav === "保留") {
      completedSectionTasks = [];
    } else if (activeNav === "今日") {
      // BUG-20260330-01: 「今日」完了セクションは今日期限の完了タスクのみ表示する
      completedSectionTasks = tasks.filter((t) => t.status === "done" && dueDatePart(t.due_date) === today);
    } else if (activeNav === "明日") {
      const tomorrow = addDays(today, 1);
      completedSectionTasks = tasks.filter((t) => t.status === "done" && dueDatePart(t.due_date) === tomorrow);
    } else if (activeNav === "次の7日間") {
      const today7 = addDays(today, 7);
      completedSectionTasks = tasks.filter((t) => t.status === "done" && dueDatePart(t.due_date) && dueDatePart(t.due_date) <= today7);
    } else if (activeNav === "受信トレイ" || activeNav === "リストなし") {
      completedSectionTasks = tasks.filter((t) => t.status === "done" && (t.list === null || t.list === undefined));
    } else if (activeNav.startsWith(TAG_NAV_PREFIX)) {
      const activeTag = activeNav.slice(TAG_NAV_PREFIX.length);
      completedSectionTasks = tasks.filter((t) => t.status === "done" && (t.tags || []).includes(activeTag));
    } else {
      completedSectionTasks = tasks.filter((t) => t.status === "done" && t.list === activeNav);
    }
  }

  const useProgressSections = !isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了";

  if (useProgressSections) {
    const isDateView = DATE_VIEWS_WITH_ON_HOLD_SECTION.has(activeNav);
    const merged = visibleTasks.filter((t) => {
      const progressStatus = normalizeProgressStatusValue(t.progressStatus, t.status);
      return !isDateView && t.status !== "done" && progressStatus !== "保留" && progressStatus !== "完了";
    });
    const onHold = visibleTasks.filter((t) => {
      const progressStatus = normalizeProgressStatusValue(t.progressStatus, t.status);
      return t.status !== "done" && progressStatus === "保留";
    });
    const completedProg = visibleTasks.filter((t) => {
      const progressStatus = normalizeProgressStatusValue(t.progressStatus, t.status);
      return !isDateView && progressStatus === "完了";
    });
    progressSections = [];
    if (merged.length > 0) progressSections.push({ label: "未着・仕掛", tasks: merged });
    if (onHold.length > 0) progressSections.push({ label: "保留", tasks: onHold });
    if (completedProg.length > 0) progressSections.push({ label: "完了", tasks: completedProg });
    if (progressSections.length === 0) progressSections = null;
  }

  if (initialLoading) {
    const startupProgressRatio = Math.max(0, Math.min(100, Number(startupProgress.percent) || 0)) / 100;
    return (
      <div className="startup-screen startup-screen--renderer">
        <div className="startup-panel" role="status" aria-live="polite">
          <div className="startup-logo" aria-hidden="true">C</div>
          <div className="startup-title">Cotaska</div>
          <div className="startup-message">
            {startupError || startupProgress.label}
          </div>
          <div className="startup-detail">{startupProgress.detail}</div>
          <div className="startup-progress-percent">{Math.round(startupProgress.percent)}%</div>
          <div className="startup-progress startup-progress--determinate" aria-hidden="true">
            <div
              className="startup-progress-fill"
              style={{ transform: `scaleX(${startupProgressRatio})` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <Sidebar
        activeIcon={activeIcon}
        onIconClick={handleSidebarIconClick}
        updateAlert={updateAlert}
      />
      {isSettingsMode ? (
        <SettingsPane focusRequest={settingsFocusRequest} />
      ) : isAiMode ? (
        <AiChatPane
          tasks={tasks}
          onOpenTask={handleOpenTaskFromAi}
          taskChatRequest={aiTaskChatRequest}
          onTaskChatRequestProcessed={handleTaskChatRequestProcessed}
          threadOpenRequest={aiThreadOpenRequest}
          lists={lists}
          tags={tags}
          onTaskUpdated={loadTasks}
          onToggleComplete={handleToggleComplete}
          onSetTaskDue={handleSetTaskDue}
          onSetTaskTags={handleSetTaskTags}
          onAddTag={handleAddTag}
        />
      ) : (
      <>
      {navVisible && !detailPaneExpanded && (
        <>
          <div style={{ width: navWidth, flexShrink: 0, overflow: "hidden", display: "flex", alignSelf: "stretch" }}>
            <NavPanel
              activeNav={activeNav}
              onNavClick={setActiveNav}
              allBadge={allCount}
              todayBadge={todayCount}
              tomorrowBadge={tomorrowCount}
              next7DaysBadge={next7DaysCount}
              noListBadge={noListCount}
              lists={lists}
              onAddList={handleAddList}
              onUpdateList={handleUpdateList}
              onDeleteList={handleDeleteList}
              tags={tags}
              tagCounts={tagCounts}
              onAddTag={handleAddTag}
              onDeleteTag={handleDeleteTag}
              tagNavPrefix={TAG_NAV_PREFIX}
            />
          </div>
          <div
            className={`resize-handle${paneResizeType === "nav" ? " resize-handle--active" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="ナビゲーションペインの幅を変更"
            onMouseDown={(e) => {
              e.preventDefault();
              resizeDragRef.current = { type: "nav", startX: e.clientX, startWidth: navWidth };
              setPaneResizeType("nav");
              document.body.classList.add("is-resizing-app-panes");
            }}
          />
        </>
      )}
      {!detailPaneExpanded && (
        <MainPane
          viewTitle={isSearchMode ? "検索" : (activeNav.startsWith(TAG_NAV_PREFIX) ? `タグ: #${activeNav.slice(TAG_NAV_PREFIX.length)}` : activeNav)}
          tasks={visibleTasks}
          sections={visibleSections}
          progressSections={progressSections}
          completedSectionTasks={completedSectionTasks}
          selectedTaskId={selectedTask?.id}
          onTaskClick={setSelectedTask}
          onTaskDoubleClick={(task) => window.cotaskaAPI?.detailWindow?.open?.(task.id)}
          onAddTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleAddTask : null}
          onAddSubtask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleAddSubtask : null}
          onToggleComplete={!isSearchMode && activeNav !== "ゴミ箱" ? handleToggleComplete : null}
          onTrashTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleTrashTask : null}
          onRestoreTask={activeNav === "ゴミ箱" ? handleRestoreTask : null}
          onDeleteTask={activeNav === "ゴミ箱" ? handleDeleteTask : null}
          onDuplicateTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleDuplicateTask : null}
          onSetTaskList={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleSetTaskList : null}
          onSetTaskDue={!isSearchMode && activeNav !== "ゴミ箱" ? handleSetTaskDue : null}
          onReorderTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" && listSort.key === "order" ? handleReorderTask : null}
          canNestTask={canNestTask}
          onSetTaskTags={!isSearchMode && activeNav !== "ゴミ箱" ? handleSetTaskTags : null}
          lists={lists}
          tags={tags}
          isTrashed={activeNav === "ゴミ箱"}
          isCompleted={activeNav === "完了"}
          completedHasMore={completedHasMore}
          completedSectionHasMore={activeNav === "すべて" && completedHasMore}
          onLoadMoreCompleted={handleLoadMoreCompleted}
          isSearchMode={isSearchMode}
          searchKeyword={searchKeyword}
          onSearchChange={setSearchKeyword}
          searchSort={searchSort}
          onSearchSortChange={setSearchSort}
          listSort={listSort}
          onListSortChange={setListSort}
          showListSort={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了"}
        />
      )}
      {!detailPaneExpanded && (
        <div
          className={`resize-handle resize-handle--detail${paneResizeType === "detail" ? " resize-handle--active" : ""}`}
          title="詳細ペインの幅を変更"
          role="separator"
          aria-orientation="vertical"
          aria-label="詳細ペインの幅を変更"
          onMouseDown={(e) => {
            e.preventDefault();
            resizeDragRef.current = { type: "detail", startX: e.clientX, startWidth: detailWidth };
            setPaneResizeType("detail");
            document.body.classList.add("is-resizing-app-panes");
          }}
        />
      )}
      <div
        className={`detail-pane-shell${detailPaneExpanded ? " detail-pane-shell--expanded" : ""}`}
        style={detailPaneExpanded ? undefined : { width: detailWidth }}
      >
        <DetailPane
          key={selectedTask?.id ?? "none"}
          task={selectedTask}
          tasks={tasks}
          onClose={() => {
            setSelectedTask(null);
            setDetailPaneExpanded(false);
          }}
          onSelectTask={setSelectedTask}
          onSaved={handleSaved}
          onToggleComplete={handleToggleComplete}
          onSetTaskDue={handleSetTaskDue}
          lists={lists}
          tags={tags}
          onSetTaskTags={handleSetTaskTags}
          onAddTag={handleAddTag}
          onStartAiChat={handleStartTaskAiChat}
          expanded={detailPaneExpanded}
          onToggleExpanded={() => setDetailPaneExpanded((prev) => !prev)}
        />
      </div>
      {trashConfirmPresence.presentValue && (
        <div
          className="trash-confirm-overlay"
          data-motion-state={trashConfirmPresence.motionState}
          role="presentation"
          onTransitionEnd={trashConfirmPresence.handleTransitionEnd}
          onMouseDown={(e) => {
            if (!trashConfirmPresence.isExiting && e.target === e.currentTarget) setTrashConfirm(null);
          }}
        >
          <div
            className="trash-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trash-confirm-title"
          >
            <h2 id="trash-confirm-title">サブタスクも削除しますか？</h2>
            <p className="trash-confirm-message">
              「{trashConfirmPresence.presentValue.task.title}」にはサブタスクが {trashConfirmPresence.presentValue.descendants.length} 件あります。
            </p>
            <div className="trash-confirm-summary">
              <span>全て削除: 配下タスクもゴミ箱へ移動</span>
              <span>親だけ削除: 直下のサブタスクを親なしに更新</span>
            </div>
            <div className="trash-confirm-actions">
              <button
                type="button"
                className="trash-confirm-btn trash-confirm-btn--danger"
                disabled={trashConfirmPresence.isExiting}
                onClick={async () => {
                  const pending = trashConfirmPresence.presentValue;
                  setTrashConfirm(null);
                  await executeTrashTask(pending.task, pending.descendants, pending.directChildren, "all");
                }}
              >
                全て削除
              </button>
              <button
                type="button"
                className="trash-confirm-btn trash-confirm-btn--primary"
                disabled={trashConfirmPresence.isExiting}
                onClick={async () => {
                  const pending = trashConfirmPresence.presentValue;
                  setTrashConfirm(null);
                  await executeTrashTask(pending.task, pending.descendants, pending.directChildren, "parent-only");
                }}
              >
                親だけ削除
              </button>
              <button
                type="button"
                className="trash-confirm-btn trash-confirm-btn--cancel"
                disabled={trashConfirmPresence.isExiting}
                onClick={() => setTrashConfirm(null)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default App;
