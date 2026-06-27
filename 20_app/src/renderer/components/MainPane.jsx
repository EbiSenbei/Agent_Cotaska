import React, { useEffect, useMemo, useRef, useState } from "react";
import DueDatePopover from "./DueDatePopover";
import { buildTaskTree } from "../lib/taskTree";

// 優先度アイコン定義
const PRIORITY = {
  high:   { label: "!!", cls: "priority-high"   },
  medium: { label: "!",  cls: "priority-medium" },
};
const MAX_TASK_TREE_DEPTH = 5;
const VIRTUALIZE_THRESHOLD = 120;
const VIRTUAL_ROW_HEIGHT = 41;
const VIRTUAL_OVERSCAN = 10;

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addLocalDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const parsed = new Date(y, m - 1, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) return null;
  return formatLocalDate(parsed);
}

function extractQuickAddDate(rawTitle) {
  const raw = String(rawTitle || "");
  const today = new Date();
  const keywordPatterns = [
    { pattern: /(^|\s)(今日)(?=\s|$)/, days: 0 },
    { pattern: /(^|\s)(明日)(?=\s|$)/, days: 1 },
    { pattern: /(^|\s)(明後日)(?=\s|$)/, days: 2 },
  ];

  for (const item of keywordPatterns) {
    const match = raw.match(item.pattern);
    if (!match) continue;
    const dueDate = formatLocalDate(addLocalDays(today, item.days));
    const title = raw.replace(match[0], match[1] || " ").replace(/\s+/g, " ").trim();
    return { title, dueDate, dateLabel: match[2] };
  }

  const fullDateMatch = raw.match(/(^|\s)(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?=\s|$)/);
  if (fullDateMatch) {
    const dueDate = normalizeDateParts(fullDateMatch[2], fullDateMatch[3], fullDateMatch[4]);
    if (dueDate) {
      const title = raw.replace(fullDateMatch[0], fullDateMatch[1] || " ").replace(/\s+/g, " ").trim();
      return { title, dueDate, dateLabel: fullDateMatch[0].trim() };
    }
  }

  const slashDateMatch = raw.match(/(^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/);
  if (slashDateMatch) {
    const dueDate = normalizeDateParts(today.getFullYear(), slashDateMatch[2], slashDateMatch[3]);
    if (dueDate) {
      const title = raw.replace(slashDateMatch[0], slashDateMatch[1] || " ").replace(/\s+/g, " ").trim();
      return { title, dueDate, dateLabel: slashDateMatch[0].trim() };
    }
  }

  const jpDateMatch = raw.match(/(^|\s)(\d{1,2})月(\d{1,2})日?(?=\s|$)/);
  if (jpDateMatch) {
    const dueDate = normalizeDateParts(today.getFullYear(), jpDateMatch[2], jpDateMatch[3]);
    if (dueDate) {
      const title = raw.replace(jpDateMatch[0], jpDateMatch[1] || " ").replace(/\s+/g, " ").trim();
      return { title, dueDate, dateLabel: jpDateMatch[0].trim() };
    }
  }

  return { title: raw.trim(), dueDate: null, dateLabel: "" };
}

function getQuickAddListToken(rawTitle) {
  return String(rawTitle || "").match(/(?:^|\s)~([^\s~]*)$/);
}

function normalizeListName(list) {
  if (!list) return "";
  if (typeof list === "string") return list;
  return String(list.name || "").trim();
}

/**
 * MainPane — ヘッダー・クイック追加バー・タスクリスト表示（flex: 1）
 *
 * Props:
 *   viewTitle        : string
 *   tasks            : Task[]               — 表示するタスク（フラット）
 *   sections         : { label, tasks }[] | null — セクション表示（今日・次の7日間）
 *   selectedTaskId   : number | null
 *   isTrashed        : boolean          — ゴミ箱ビューかどうか
 *   isCompleted      : boolean          — 完了ビューかどうか
 *   onTaskClick      : (task) => void
 *   onAddTask        : (title) => void  — null のとき入力欄を非表示
 *   onAddSubtask     : (parentTask, title) => void
 *   onToggleComplete : (task) => void
 *   onTrashTask      : (task) => void   — ゴミ箱移動
 *   onDuplicateTask  : (task) => void   — タスク複製
 *   onSetTaskList    : (task, listId) => void   — リスト変更
 *   onRestoreTask    : (task) => void   — ゴミ箱から復元
 *   onDeleteTask     : (task) => void   — 完全削除
 *   lists            : List[]           — リスト一覧
 */
function MainPane({
  viewTitle, tasks, sections, progressSections, completedSectionTasks = [], selectedTaskId, isTrashed, isCompleted,
  completedHasMore = false, onLoadMoreCompleted,
  isSearchMode, onSearchChange, searchSort = { key: "id", direction: "asc" }, onSearchSortChange,
  listSort = { key: "order", direction: "asc" }, onListSortChange, showListSort = false,
  onTaskClick, onAddTask, onAddSubtask, onToggleComplete,
  onTrashTask, onRestoreTask, onDeleteTask, onDuplicateTask, onSetTaskList, onSetTaskDue,
  onReorderTask,
  canNestTask,
  lists,
  tags = [],
  onSetTaskTags,
}) {
  const inputRef    = useRef(null);
  const inlineInputRef = useRef(null);
  const contextMenuRef = useRef(null);
  const taskListRef = useRef(null);
  const searchTimer = useRef(null);
  const dragHandleTaskIdRef = useRef(null);
  const [localSearch, setLocalSearch] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState(null);
  const [pathCopyNotice, setPathCopyNotice] = useState(null);
  const [inlineInput, setInlineInput] = useState(null); // { parentId, value }
  const [expanded, setExpanded] = useState({});
  const [completedSectionExpanded, setCompletedSectionExpanded] = useState(true);
  const [sectionCollapsed, setSectionCollapsed] = useState({});
  const [dueEditorTaskId, setDueEditorTaskId] = useState(null);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [hoveredSectionKey, setHoveredSectionKey] = useState(null);
  const [quickAddValue, setQuickAddValue] = useState("");
  const [quickAddList, setQuickAddList] = useState(null);
  const [quickAddListIndex, setQuickAddListIndex] = useState(0);
  const [taskListScrollTop, setTaskListScrollTop] = useState(0);
  const [taskListViewportHeight, setTaskListViewportHeight] = useState(0);
  const dragEnabled = Boolean(onReorderTask) && !isTrashed && !isCompleted && !isSearchMode;
  const listNames = useMemo(
    () => Array.from(new Set((lists || []).map(normalizeListName).filter(Boolean))),
    [lists]
  );
  const listToken = getQuickAddListToken(quickAddValue);
  const listQuery = listToken ? listToken[1] || "" : "";
  const quickAddListCandidates = useMemo(() => {
    if (!listToken) return [];
    const normalizedQuery = listQuery.toLowerCase();
    return listNames
      .filter((name) => !normalizedQuery || name.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [listNames, listQuery, listToken]);
  const showQuickAddListCandidates = Boolean(listToken) && !quickAddList && quickAddListCandidates.length > 0;

  const quickAddDatePreview = useMemo(() => {
    const raw = quickAddValue.trim();
    if (!raw) return { dueDate: null, dateLabel: "" };
    const currentListToken = getQuickAddListToken(raw);
    const titleWithoutList = currentListToken ? raw.slice(0, currentListToken.index).trim() : raw;
    return extractQuickAddDate(titleWithoutList);
  }, [quickAddValue]);

  const selectQuickAddList = (name) => {
    setQuickAddList(name);
    setQuickAddListIndex(0);
    inputRef.current?.focus();
  };

  const buildQuickAddPayload = () => {
    const raw = quickAddValue.trim();
    const currentListToken = getQuickAddListToken(raw);
    const exactList = currentListToken
      ? listNames.find((name) => name.toLowerCase() === (currentListToken[1] || "").toLowerCase())
      : null;
    const selectedList = quickAddList || exactList || null;
    const titleWithoutList = selectedList && currentListToken
      ? raw.slice(0, currentListToken.index).trim()
      : raw;
    const parsed = extractQuickAddDate(titleWithoutList);
    const title = parsed.title || titleWithoutList || raw;
    return {
      title,
      due_date: parsed.dueDate,
      list: selectedList,
    };
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") return;
    if (e.nativeEvent?.isComposing || e.isComposing) return;
    if (showQuickAddListCandidates && !quickAddList) {
      e.preventDefault();
      selectQuickAddList(quickAddListCandidates[quickAddListIndex] || quickAddListCandidates[0]);
      return;
    }
    const payload = buildQuickAddPayload();
    if (payload.title.trim()) {
      onAddTask?.(payload);
      setQuickAddValue("");
      setQuickAddList(null);
    }
    inputRef.current?.blur();
  };

  const handleQuickAddKeyDown = (e) => {
    if (e.key === "ArrowDown" && showQuickAddListCandidates) {
      e.preventDefault();
      setQuickAddListIndex((prev) => Math.min(prev + 1, quickAddListCandidates.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && showQuickAddListCandidates) {
      e.preventDefault();
      setQuickAddListIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setQuickAddList(null);
      setQuickAddListIndex(0);
      return;
    }
    handleKeyDown(e);
  };

  const handleQuickAddChange = (e) => {
    const next = e.target.value;
    setQuickAddValue(next);
    setQuickAddListIndex(0);
    setQuickAddList(null);
  };

  // 検索インプット「debounce 300ms
  const handleSearchInput = (e) => {
    const val = e.target.value;
    setLocalSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onSearchChange?.(val), 300);
  };
  const handleSearchClear = () => {
    setLocalSearch("");
    clearTimeout(searchTimer.current);
    onSearchChange?.("");
  };
  const handleSearchSortKeyChange = (e) => {
    onSearchSortChange?.({ ...searchSort, key: e.target.value });
  };
  const handleSearchSortDirectionToggle = () => {
    onSearchSortChange?.({
      ...searchSort,
      direction: searchSort.direction === "asc" ? "desc" : "asc",
    });
  };
  const handleListSortKeyChange = (e) => {
    onListSortChange?.({ ...listSort, key: e.target.value });
  };
  const handleListSortDirectionToggle = () => {
    onListSortChange?.({
      ...listSort,
      direction: listSort.direction === "asc" ? "desc" : "asc",
    });
  };

  useEffect(() => {
    const el = taskListRef.current;
    if (!el) return undefined;

    const updateViewport = () => setTaskListViewportHeight(el.clientHeight || 0);
    updateViewport();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewport);
      return () => window.removeEventListener("resize", updateViewport);
    }

    const observer = new ResizeObserver(updateViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = taskListRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setTaskListScrollTop(0);
  }, [viewTitle, isSearchMode, searchSort.key, searchSort.direction, listSort.key, listSort.direction]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    setContextMenuPos({ top: contextMenu.y, left: contextMenu.x });
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const MARGIN = 8;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = contextMenu.y;
    let left = contextMenu.x;

    if (rect.bottom > viewportHeight - MARGIN) {
      top = Math.max(MARGIN, top - (rect.bottom - (viewportHeight - MARGIN)));
    }
    if (rect.right > viewportWidth - MARGIN) {
      left = Math.max(MARGIN, left - (rect.right - (viewportWidth - MARGIN)));
    }

    if (top !== contextMenu.y || left !== contextMenu.x) {
      setContextMenuPos({ top, left });
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!pathCopyNotice) return undefined;
    const timer = window.setTimeout(() => setPathCopyNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [pathCopyNotice]);

  const handleCopyTaskFilePath = async (task) => {
    if (!task || task.is_invalid) return;
    try {
      const result = await window.cotaskaAPI?.shell?.copyTaskFilePath?.(task.id);
      setPathCopyNotice({
        type: result?.ok ? "success" : "error",
        message: result?.ok ? "パスをコピーしました。" : (result?.error || "パスをコピーできませんでした。"),
      });
    } catch (error) {
      setPathCopyNotice({ type: "error", message: error?.message || "パスをコピーできませんでした。" });
    } finally {
      setContextMenu(null);
    }
  };

  useEffect(() => {
    if (!inlineInput) return;
    inlineInputRef.current?.focus();
  }, [inlineInput]);

  const renderInlineInput = (parentTask, depth = 1) => {
    if (!inlineInput || inlineInput.parentId !== parentTask.id) return null;
    return (
      <div key={`inline-${parentTask.id}`} className="inline-add-row" style={{ "--task-depth": depth }}>
        <span className="subtask-indent" />
        <input
          ref={inlineInputRef}
          className="inline-add-input"
          type="text"
          placeholder="サブタスクを追加（確定キーで保存）"
          value={inlineInput.value}
          onChange={(e) => setInlineInput((prev) => ({ ...prev, value: e.target.value }))}
          onKeyDown={async (e) => {
            if (e.key === "Escape") {
              setInlineInput(null);
              return;
            }
            if (e.key !== "Enter") return;
            const title = inlineInput.value.trim();
            if (!title) {
              setInlineInput(null);
              return;
            }
            await onAddSubtask?.(parentTask, title);
            setInlineInput(null);
          }}
          onBlur={() => setInlineInput(null)}
        />
      </div>
    );
  };

  const resetDragState = () => {
    setDraggingTaskId(null);
    setDropTarget(null);
    setHoveredSectionKey(null);
    dragHandleTaskIdRef.current = null;
  };

  const getRowDropModeByPoint = (clientY, targetTask, draggedTaskId = draggingTaskId, rowElement = null) => {
    const rect = rowElement?.getBoundingClientRect?.() || { top: 0, height: 0 };
    const y = clientY - rect.top;
    const ratio = rect.height > 0 ? y / rect.height : 0;
    if (ratio >= 0.3 && ratio <= 0.7) {
      const allowed = canNestTask?.(draggedTaskId, targetTask.id) ?? true;
      return allowed ? "child" : "invalid-child";
    }
    return ratio < 0.3 ? "before" : "after";
  };

  // タスク行を描画する関数
  const renderTaskRow = (task, showSep, depth = 1, childCount = 0, sectionMeta = null) => {
    const isInvalid = Boolean(task.is_invalid);
    const isSubtask = depth > 1;
    const isHierarchyWarning = Boolean(task.hierarchyWarning);
    const canDragTask = dragEnabled && !task.hierarchyOverLimit && !task.hierarchyCycle && task.status !== "done" && !isInvalid;
    const rowClassName = [
      "task-row",
      selectedTaskId === task.id ? "selected" : "",
      task.status === "done" ? "task-row--done" : "",
      isSubtask ? "task-row--subtask" : "",
      canDragTask ? "task-row--draggable" : "",
      draggingTaskId === task.id ? "task-row--dragging" : "",
      dropTarget?.taskId === task.id && dropTarget.mode === "before" && draggingTaskId !== task.id ? "task-row--drop-before" : "",
      dropTarget?.taskId === task.id && dropTarget.mode === "after" && draggingTaskId !== task.id ? "task-row--drop-after" : "",
      dropTarget?.taskId === task.id && dropTarget.mode === "child" && draggingTaskId !== task.id ? "task-row--drop-child" : "",
      dropTarget?.taskId === task.id && dropTarget.mode === "invalid-child" && draggingTaskId !== task.id ? "task-row--drop-invalid" : "",
      isInvalid ? "task-row--invalid" : "",
      isHierarchyWarning ? "task-row--hierarchy-warning" : "",
    ].filter(Boolean).join(" ");

    return (
    <React.Fragment key={task.id}>
      <div
        className={rowClassName}
        data-task-id={task.id}
        data-section-type={sectionMeta?.type || ""}
        data-section-label={sectionMeta?.label || ""}
        style={{ "--task-depth": depth }}
        onClick={() => onTaskClick?.(task)}
        draggable={canDragTask}
        onDragStart={(e) => {
          if (!canDragTask || dragHandleTaskIdRef.current !== task.id) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(task.id));
          setDraggingTaskId(task.id);
        }}
        onDragEnd={() => {
          resetDragState();
        }}
        onDragOver={(e) => {
          if (isInvalid || !dragEnabled || !draggingTaskId || draggingTaskId === task.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setHoveredSectionKey(null);
          setDropTarget({ taskId: task.id, mode: getRowDropModeByPoint(e.clientY, task, draggingTaskId, e.currentTarget) });
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          if (dropTarget?.taskId === task.id) setDropTarget(null);
        }}
        onDrop={async (e) => {
          if (isInvalid || !dragEnabled) return;
          e.preventDefault();
          e.stopPropagation();
          const draggedTaskId = e.dataTransfer.getData("text/plain") || draggingTaskId;
          const mode = getRowDropModeByPoint(e.clientY, task, draggedTaskId, e.currentTarget);
          if (!draggedTaskId || draggedTaskId === task.id || mode === "invalid-child") {
            resetDragState();
            return;
          }
          await onReorderTask?.({
            draggedTaskId,
            targetTaskId: task.id,
            toSectionType: sectionMeta?.type || null,
            toSectionLabel: sectionMeta?.label || null,
            mode,
          });
          if (mode === "child") {
            setExpanded((prev) => ({ ...prev, [task.id]: true }));
          }
          resetDragState();
        }}
        onContextMenu={(e) => {
          if (!isInvalid && !isTrashed && !isCompleted && !isSearchMode) {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, task });
          }
        }}
      >
        {depth <= MAX_TASK_TREE_DEPTH && (
          <button
            className={`expand-btn${childCount === 0 && !(inlineInput && inlineInput.parentId === task.id) ? " expand-btn--hidden" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => ({ ...prev, [task.id]: !prev[task.id] }));
            }}
            title="展開/折りたたみ"
          >
            {expanded[task.id] ? "▾" : "▸"}
          </button>
        )}
        {isSubtask && <span className="subtask-indent" />}
        <span
          className={`drag-handle${canDragTask ? "" : " drag-handle--disabled"}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (canDragTask) dragHandleTaskIdRef.current = task.id;
          }}
          onClick={(e) => e.stopPropagation()}
          title="ドラッグして並び替え・親子変更"
          aria-label="ドラッグして並び替え・親子変更"
        >
          ⠇
        </span>
        {!isTrashed && (
          <input
            type="checkbox"
            checked={task.status === "done"}
            disabled={isInvalid}
            onChange={(e) => { e.stopPropagation(); onToggleComplete?.(task); }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {!isTrashed && (
          <span className={`progress-status-badge ${isInvalid ? "invalid" : task.progressStatus === "完了" ? "done" : task.progressStatus === "仕掛" ? "in-progress" : task.progressStatus === "保留" ? "on-hold" : "not-started"}`}>
            {task.progressStatus || "未着"}
          </span>
        )}
        {isInvalid && <span className="task-warning-mark" title="タスクファイルの読み込みエラー">!</span>}
        {!isInvalid && isHierarchyWarning && <span className="task-warning-mark hierarchy" title={task.hierarchyWarning}>!</span>}
        <span className="task-title">{task.title}</span>
        {!isTrashed && PRIORITY[task.priority] && (
          <span className={`priority-icon ${PRIORITY[task.priority].cls}`}>
            {PRIORITY[task.priority].label}
          </span>
        )}
        {!isTrashed && (
          <span
            className="task-due-anchor"
            onClick={(e) => {
              e.stopPropagation();
              if (!isInvalid && onSetTaskDue) setDueEditorTaskId(task.id);
            }}
          >
            <span className={`task-due${task.overdue ? " overdue" : ""}${task.due ? "" : " task-due--empty"}`}>
              {task.due || "未設定"}
            </span>
            {onSetTaskDue && dueEditorTaskId === task.id && (
              <DueDatePopover
                className="due-dialog--floating"
                placementMode="main-auto"
                value={task.due_date}
                onChange={async (nextDue) => {
                  await onSetTaskDue(task, nextDue);
                  setDueEditorTaskId(null);
                }}
                onClear={async () => {
                  await onSetTaskDue(task, null);
                  setDueEditorTaskId(null);
                }}
                onClose={() => setDueEditorTaskId(null)}
              />
            )}
          </span>
        )}
        {dropTarget?.taskId === task.id && dropTarget.mode === "child" && (
          <span className="drop-child-hint">子にする</span>
        )}
        {dropTarget?.taskId === task.id && dropTarget.mode === "invalid-child" && (
          <span className="drop-child-hint drop-child-hint--invalid">不可</span>
        )}
        {/* ゴミ箱ビュー: 復元・完全削除ボタン */}
        {isTrashed && (
          <span className="task-actions">
            <button
              className="task-action-btn restore"
              title="復元"
              onClick={(e) => { e.stopPropagation(); onRestoreTask?.(task); }}
            >↩</button>
            <button
              className="task-action-btn delete"
              title="完全削除"
              onClick={(e) => { e.stopPropagation(); onDeleteTask?.(task); }}
            >✕</button>
          </span>
        )}
      </div>
      {showSep && <div className="task-separator" />}
    </React.Fragment>
    );
  };

  const renderVirtualizedItems = (items) => {
    if (items.length <= VIRTUALIZE_THRESHOLD || draggingTaskId) return items;

    const viewportHeight = taskListViewportHeight || VIRTUAL_ROW_HEIGHT * 20;
    const startIndex = Math.max(0, Math.floor(taskListScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const endIndex = Math.min(items.length, startIndex + visibleCount);
    const topHeight = startIndex * VIRTUAL_ROW_HEIGHT;
    const bottomHeight = Math.max(0, (items.length - endIndex) * VIRTUAL_ROW_HEIGHT);

    return [
      topHeight > 0 ? <div key="virtual-top-spacer" className="task-virtual-spacer" style={{ height: topHeight }} /> : null,
      ...items.slice(startIndex, endIndex),
      bottomHeight > 0 ? <div key="virtual-bottom-spacer" className="task-virtual-spacer" style={{ height: bottomHeight }} /> : null,
    ].filter(Boolean);
  };

  const renderTaskTree = (list, sectionMeta = null, options = {}) => {
    const { roots, byParent } = buildTaskTree(list);
    const items = [];

    const pushNode = (task, depth, showSep) => {
      const children = depth < MAX_TASK_TREE_DEPTH ? (byParent[task.id] || []) : [];
      const parentExpanded = expanded[task.id] || inlineInput?.parentId === task.id;
      items.push(renderTaskRow(task, showSep, depth, children.length, sectionMeta));
      if (parentExpanded) {
        children.forEach((child) => {
          pushNode(child, depth + 1, false);
        });
        items.push(renderInlineInput(task, depth + 1));
      }
    };

    roots.forEach((parent, idx) => {
      pushNode(parent, 1, idx < roots.length - 1);
    });

    return options.virtualize ? renderVirtualizedItems(items) : items;
  };

  // フラットリスト（ゴミ箱・完了・リスト・受信トレイ・検索）
  const renderFlatList = () => (
    <>
      {isSearchMode && localSearch && (
        <div className="search-results-count">
          {tasks.length > 0 ? `${tasks.length} 件見つかりました` : ""}
        </div>
      )}
      {tasks.length === 0 && (
        <div className="task-empty">
          {isTrashed    ? "ゴミ箱は空です"                    :
           isSearchMode ? (localSearch ? "一致するタスクがありません" : "キーワードを入力してください") :
           "タスクがありません"}
        </div>
      )}
      {isTrashed && tasks.length > 0 && (
        <div className="section-header">🗑️ ゴミ箱</div>
      )}
      {renderTaskTree(tasks, { type: "flat", label: viewTitle }, { virtualize: true })}
      {isCompleted && completedHasMore && (
        <div className="task-load-more">
          <button type="button" className="task-load-more-btn" onClick={() => onLoadMoreCompleted?.()}>
            次を読み込む
          </button>
        </div>
      )}
    </>
  );

  const renderProgressSections = () => {
    const totalCount = progressSections.reduce((s, sec) => s + sec.tasks.length, 0);
    return (
      <>
        {totalCount === 0 && (
          <div className="task-empty">タスクがありません</div>
        )}
        {progressSections.map((section) => (
          <div
            key={section.label}
            className={`drop-section${hoveredSectionKey === `progress:${section.label}` ? " drop-section--hover" : ""}`}
            data-drop-section-type="progress"
            data-drop-section-label={section.label}
            onDragOver={(e) => {
              if (!dragEnabled || !draggingTaskId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setHoveredSectionKey(`progress:${section.label}`);
              setDropTarget(null);
            }}
            onDragLeave={() => {
              if (hoveredSectionKey === `progress:${section.label}`) setHoveredSectionKey(null);
            }}
            onDrop={(e) => {
              if (!dragEnabled) return;
              e.preventDefault();
              e.stopPropagation();
              const draggedTaskId = e.dataTransfer.getData("text/plain") || draggingTaskId;
              if (!draggedTaskId) return;
              onReorderTask?.({
                draggedTaskId,
                toSectionType: "progress",
                toSectionLabel: section.label,
              });
              resetDragState();
            }}
          >
            <div
              className="section-header section-header--collapsible"
              onClick={() => setSectionCollapsed((prev) => ({ ...prev, [`progress:${section.label}`]: !prev[`progress:${section.label}`] }))}
            >
              {sectionCollapsed[`progress:${section.label}`] ? "▸" : "▾"} {section.label} ({section.tasks.length})
            </div>
            {!sectionCollapsed[`progress:${section.label}`] && renderTaskTree(section.tasks, { type: "progress", label: section.label })}
          </div>
        ))}
      </>
    );
  };

  // セクション別リスト（今日・次の7日間）
  const renderSections = () => {
    const totalCount = sections.reduce((s, sec) => s + sec.tasks.length, 0);
    return (
      <>
        {totalCount === 0 && !progressSections && (
          <div className="task-empty">タスクがありません</div>
        )}
        {sections.map((section) => (
          <div
            key={section.label}
            className={`drop-section${hoveredSectionKey === `date:${section.label}` ? " drop-section--hover" : ""}`}
            data-drop-section-type="date"
            data-drop-section-label={section.label}
            onDragOver={(e) => {
              if (!dragEnabled || !draggingTaskId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setHoveredSectionKey(`date:${section.label}`);
              setDropTarget(null);
            }}
            onDragLeave={() => {
              if (hoveredSectionKey === `date:${section.label}`) setHoveredSectionKey(null);
            }}
            onDrop={(e) => {
              if (!dragEnabled) return;
              e.preventDefault();
              e.stopPropagation();
              const draggedTaskId = e.dataTransfer.getData("text/plain") || draggingTaskId;
              if (!draggedTaskId) return;
              onReorderTask?.({
                draggedTaskId,
                toSectionType: "date",
                toSectionLabel: section.label,
              });
              resetDragState();
            }}
          >
            <div
              className={`section-header section-header--collapsible${section.label.includes("遅延") ? " overdue" : ""}`}
              onClick={() => setSectionCollapsed((prev) => ({ ...prev, [`date:${section.label}`]: !prev[`date:${section.label}`] }))}
            >
              {sectionCollapsed[`date:${section.label}`] ? "▸" : "▾"} {section.label} ({section.tasks.length})
            </div>
            {!sectionCollapsed[`date:${section.label}`] && renderTaskTree(section.tasks, { type: "date", label: section.label })}
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="main-pane">
      {/* ヘッダー */}
      <div className="main-header">
        {isSearchMode ? (
          /* 検索バー */
          <div className="search-header">
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input
                className="search-input"
                type="text"
                placeholder="タスクを検索..."
                value={localSearch}
                onChange={handleSearchInput}
                autoFocus
                onKeyDown={(e) => e.key === "Escape" && handleSearchClear()}
              />
              {localSearch && (
                <button className="search-clear-btn" onClick={handleSearchClear}>✕</button>
              )}
            </div>
            <div className="search-sort">
              <span className="search-sort-icon" title="並び替え">⇅</span>
              <select
                className="search-sort-select"
                value={searchSort.key}
                onChange={handleSearchSortKeyChange}
                aria-label="検索結果の並び替え項目"
              >
                <option value="id">ID</option>
                <option value="date">日付</option>
                <option value="title">名前</option>
              </select>
              <button
                className="search-sort-direction"
                type="button"
                onClick={handleSearchSortDirectionToggle}
                title={searchSort.direction === "asc" ? "昇順" : "降順"}
                aria-label="検索結果の昇順と降順を切り替え"
              >
                {searchSort.direction === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>
        ) : (
          /* 通常ヘッダー */
          <>
            <div className="view-title">{viewTitle}</div>
            <div className="header-actions">
              {showListSort && (
                <div className="list-sort">
                  <span className="list-sort-icon" title="並び替え">⇅</span>
                  <select
                    className="list-sort-select"
                    value={listSort.key}
                    onChange={handleListSortKeyChange}
                    aria-label="リスト表示の並び替え項目"
                  >
                    <option value="order">標準</option>
                    <option value="id">ID</option>
                    <option value="date">日付</option>
                    <option value="title">名前</option>
                  </select>
                  <button
                    className="list-sort-direction"
                    type="button"
                    onClick={handleListSortDirectionToggle}
                    title={listSort.direction === "asc" ? "昇順" : "降順"}
                    aria-label="リスト表示の昇順と降順を切り替え"
                    disabled={listSort.key === "order"}
                  >
                    {listSort.direction === "asc" ? "↑" : "↓"}
                  </button>
                </div>
              )}
              <div className="h-icon" title="メニュー">⋯</div>
            </div>
          </>
        )}
      </div>

      {/* クイック追加バー（ゴミ箱・完了ビューでは非表示） */}
      {onAddTask && (
        <div className="quick-add">
          <span className="qa-icon">＋</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="タスクを追加（確定キーで保存）"
            value={quickAddValue}
            onChange={handleQuickAddChange}
            onKeyDown={handleQuickAddKeyDown}
          />
          {quickAddDatePreview.dueDate && (
            <span
              className="qa-date-chip"
              title={`保存予定の日付: ${quickAddDatePreview.dueDate}`}
            >
              日付 {quickAddDatePreview.dateLabel || quickAddDatePreview.dueDate}
            </span>
          )}
          {quickAddList && (
            <button
              className="qa-list-chip"
              type="button"
              title="選択中のリストを解除"
              onClick={() => setQuickAddList(null)}
            >
              {quickAddList} ×
            </button>
          )}
          {showQuickAddListCandidates && (
            <div className="qa-list-suggest" role="listbox" aria-label="リスト候補">
              {quickAddListCandidates.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  className={`qa-list-suggest-item${index === quickAddListIndex ? " active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectQuickAddList(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* タスクリスト */}
      <div
        ref={taskListRef}
        className="task-list"
        onScroll={(e) => setTaskListScrollTop(e.currentTarget.scrollTop)}
      >
        {sections ? (
          <>
            {renderSections()}
            {progressSections && progressSections.length > 0 && renderProgressSections()}
          </>
        ) : (progressSections ? renderProgressSections() : renderFlatList())}
        {/* CHG-011: 完了セクション */}
        {!isTrashed && !isCompleted && completedSectionTasks.length > 0 && (
          <>
            <div
              className="section-header section-header--completed"
              onClick={() => setCompletedSectionExpanded((prev) => !prev)}
            >
              {completedSectionExpanded ? "▾" : "▸"} ✅ 完了 ({completedSectionTasks.length})
            </div>
            {completedSectionExpanded && renderTaskTree(completedSectionTasks, { type: "completed", label: "完了" })}
          </>
        )}
      </div>

      {/* T-014-04: コンテキストメニュー */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenuPos?.top ?? contextMenu.y, left: contextMenuPos?.left ?? contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* サブタスクの追加 */}
          <button
            className={`ctx-item${contextMenu.task.hierarchyOverLimit || (contextMenu.task.hierarchyDepth || 1) >= MAX_TASK_TREE_DEPTH ? " ctx-item--disabled" : ""}`}
            onClick={() => {
              if (contextMenu.task.hierarchyOverLimit || (contextMenu.task.hierarchyDepth || 1) >= MAX_TASK_TREE_DEPTH) return;
              setExpanded((prev) => ({ ...prev, [contextMenu.task.id]: true }));
              setInlineInput({ parentId: contextMenu.task.id, value: "", mode: "subtask" });
              setContextMenu(null);
            }}
          >
            ➕ サブタスクの追加
          </button>
          <div className="ctx-separator"></div>

          {/* リスト設定（サブメニュー） */}
          <div className="ctx-item ctx-item--has-sub">
            <span>📁 リスト設定</span>
            <div className="ctx-submenu">
              <button
                className="ctx-item"
                onClick={() => {
                  onSetTaskList?.(contextMenu.task, null);
                  setContextMenu(null);
                }}
              >
                リストなし
              </button>
              {lists?.map((list) => (
                <button
                  key={list.name}
                  className="ctx-item"
                  onClick={() => {
                    onSetTaskList?.(contextMenu.task, list.name);
                    setContextMenu(null);
                  }}
                >
                  {list.name}
                </button>
              ))}
            </div>
          </div>

          {/* タグ設定（サブメニュー） */}
          <div className="ctx-item ctx-item--has-sub">
            <span>🏷️ タグ設定</span>
            <div className="ctx-submenu">
              {tags.length === 0 && (
                <button className="ctx-item ctx-item--disabled">タグなし</button>
              )}
              {tags.map((tag) => {
                const hasTag = (contextMenu.task.tags || []).includes(tag);
                return (
                  <button
                    key={tag}
                    className="ctx-item"
                    onClick={() => {
                      const current = contextMenu.task.tags || [];
                      const next = hasTag ? current.filter((t) => t !== tag) : [...current, tag];
                      onSetTaskTags?.(contextMenu.task, next);
                      setContextMenu(null);
                    }}
                  >
                    {hasTag ? "✓ " : "   "}{tag}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="ctx-separator"></div>

          {/* 複製する */}
          <button
            className="ctx-item"
            onClick={() => {
              onDuplicateTask?.(contextMenu.task);
              setContextMenu(null);
            }}
          >
            📋 複製する
          </button>

          {/* パスのコピー */}
          <button
            className="ctx-item"
            onClick={() => handleCopyTaskFilePath(contextMenu.task)}
          >
            📄 パスのコピー
          </button>

          {/* ごみ箱に移動 */}
          <button
            className="ctx-item ctx-item--danger"
            onClick={() => {
              onTrashTask?.(contextMenu.task);
              setContextMenu(null);
            }}
          >
            🗑️ ごみ箱に移動
          </button>
        </div>
      )}
      {pathCopyNotice && (
        <div className={`copy-toast${pathCopyNotice.type === "error" ? " copy-toast--error" : ""}`} role="status" aria-live="polite">
          {pathCopyNotice.message}
        </div>
      )}

    </div>
  );
}

export default MainPane;
