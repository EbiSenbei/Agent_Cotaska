import React, { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import DetailPane from "./DetailPane";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const TASK_ID_PATTERN = /\bT-\d{4}\b/g;
const SANDBOX_OPTIONS = [
  { value: "read-only", label: "読み取り専用" },
  { value: "workspace-write", label: "作業フォルダ" },
  { value: "danger-full-access", label: "フルアクセス" },
];
const SANDBOX_VALUES = new Set(SANDBOX_OPTIONS.map((option) => option.value));
const REFERENCE_SEND_OPTIONS = [
  { value: "default", label: "参照:設定" },
  { value: "force", label: "参照:送る" },
  { value: "skip", label: "参照:送らない" },
];
const REFERENCE_SEND_VALUES = new Set(REFERENCE_SEND_OPTIONS.map((option) => option.value));
const CONTEXT_PANEL_WIDTH_KEY = "cotaska.aiChat.contextPanelWidth";
const CONTEXT_PANEL_MIN_WIDTH = 320;
const CONTEXT_PANEL_MAX_WIDTH = 720;
const CONTEXT_PANEL_DEFAULT_WIDTH = 410;
const WORKDIR_REQUIRED_MESSAGE = "作業フォルダを設定してください。設定画面で作業フォルダを選択してから送信してください。";

markdown.core.ruler.after("inline", "cotaska_task_links", (state) => {
  state.tokens.forEach((blockToken) => {
    if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) return;
    const nextChildren = [];
    blockToken.children.forEach((token) => {
      if (token.type !== "text") {
        nextChildren.push(token);
        return;
      }
      const text = token.content || "";
      let cursor = 0;
      for (const match of text.matchAll(TASK_ID_PATTERN)) {
        const taskId = match[0];
        const index = match.index || 0;
        if (index > cursor) {
          const textToken = new state.Token("text", "", 0);
          textToken.content = text.slice(cursor, index);
          nextChildren.push(textToken);
        }
        const linkToken = new state.Token("html_inline", "", 0);
        linkToken.content = `<button type="button" class="ai-task-link" data-task-id="${taskId}">${taskId}</button>`;
        nextChildren.push(linkToken);
        cursor = index + taskId.length;
      }
      if (cursor < text.length) {
        const textToken = new state.Token("text", "", 0);
        textToken.content = text.slice(cursor);
        nextChildren.push(textToken);
      }
    });
    blockToken.children = nextChildren;
  });
});

function getAiChatApi() {
  return window.cotaskaAPI?.aiChat || null;
}

function createDraftThreadTitle(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "新しいAIチャット";
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

function normalizeSandboxMode(value) {
  return SANDBOX_VALUES.has(value) ? value : "read-only";
}

function normalizeReferenceSendMode(value) {
  return REFERENCE_SEND_VALUES.has(value) ? value : "default";
}

function openCodexAuthSettings() {
  window.dispatchEvent(new CustomEvent("cotaska:openSettings", { detail: { target: "codex-auth" } }));
}

function clampContextPanelWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CONTEXT_PANEL_DEFAULT_WIDTH;
  return Math.min(CONTEXT_PANEL_MAX_WIDTH, Math.max(CONTEXT_PANEL_MIN_WIDTH, Math.round(numeric)));
}

function loadContextPanelWidth() {
  try {
    return clampContextPanelWidth(window.localStorage?.getItem(CONTEXT_PANEL_WIDTH_KEY));
  } catch (_error) {
    return CONTEXT_PANEL_DEFAULT_WIDTH;
  }
}

function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function MarkdownPreview({ content, error, onOpenTask, onOpenLink }) {
  const html = useMemo(() => markdown.render(String(content || "")), [content]);
  return (
    <div
      className={`ai-message-markdown${error ? " ai-message-error" : ""}`}
      onClick={(event) => {
        const taskLink = event.target.closest?.("[data-task-id]");
        if (taskLink) {
          event.preventDefault();
          onOpenTask?.(taskLink.getAttribute("data-task-id"));
          return;
        }

        const anchor = event.target.closest?.("a[href]");
        if (!anchor) return;
        event.preventDefault();
        onOpenLink?.(anchor.getAttribute("href"));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function AiChatPane({
  tasks = [],
  onOpenTask,
  taskChatRequest = null,
  lists = [],
  tags = [],
  onTaskUpdated,
  onToggleComplete,
  onSetTaskDue,
  onSetTaskTags,
  onAddTag,
}) {
  const messageScrollRef = useRef(null);
  const pendingAutoScrollRef = useRef(false);
  const activeSendRequestRef = useRef(null);
  const activeRunHydrationKeyRef = useRef("");
  const [sideTab, setSideTab] = useState("threads");
  const [contextPanel, setContextPanel] = useState(null);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [contextPanelWidth, setContextPanelWidth] = useState(loadContextPanelWidth);
  const [isResizingContextPanel, setIsResizingContextPanel] = useState(false);
  const [draft, setDraft] = useState("");
  const [sideSearchQuery, setSideSearchQuery] = useState("");
  const [filePreviewMode, setFilePreviewMode] = useState(false);
  const [threads, setThreads] = useState([]);
  const [activeRuns, setActiveRuns] = useState([]);
  const [messages, setMessages] = useState([]);
  const [references, setReferences] = useState([]);
  const [workdirTree, setWorkdirTree] = useState({ rows: [], root: "", truncated: false });
  const [isLoadingWorkdirTree, setIsLoadingWorkdirTree] = useState(false);
  const [expandedWorkdirPaths, setExpandedWorkdirPaths] = useState(() => new Set());
  const [isSending, setIsSending] = useState(false);
  const [streamEvents, setStreamEvents] = useState([]);
  const [expandedStreamEventIds, setExpandedStreamEventIds] = useState(() => new Set());
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [sandboxMode, setSandboxMode] = useState("read-only");
  const [referenceSendMode, setReferenceSendMode] = useState("default");
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [workdirContextMenu, setWorkdirContextMenu] = useState(null);
  const [isComposeDragOver, setIsComposeDragOver] = useState(false);
  const [runtimeState, setRuntimeState] = useState({
    ready: false,
    status: "unavailable",
    message: "cotaskaAPI.aiChat はまだ接続されていません。",
  });
  const lastTaskChatRequestRef = useRef(null);

  const aiChatApi = useMemo(() => getAiChatApi(), []);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) || null;
  const activeRunByThreadId = useMemo(() => {
    const map = new Map();
    activeRuns.forEach((run) => {
      if (run?.thread_id) map.set(run.thread_id, run);
    });
    return map;
  }, [activeRuns]);
  const selectedActiveRun = selectedThreadId ? activeRunByThreadId.get(selectedThreadId) || null : null;
  const chatTitle = selectedThread?.title || "新しいAIチャット";

  const mapThread = (thread) => ({
    id: thread.thread_id,
    title: thread.title || "無題のAIチャット",
    subtitle: thread.primary_task_id || thread.change_id || "AIスレッド",
    status: thread.thread_status || "active",
    time: thread.thread_status === "archived" ? "アーカイブ" : "",
    badges: [thread.change_id, thread.primary_task_id].filter(Boolean).slice(0, 3),
  });

  const mapMessage = (message) => ({
    id: message.message_id,
    role: message.role === "assistant" ? "assistant" : "user",
    author: message.role === "assistant" ? "Codex SDK" : "ユーザー",
    body: message.error_message || message.content || "",
    error: Boolean(message.error_message),
    createdAt: message.created_at,
    time: formatMessageTime(message.created_at),
  });

  const mapReference = (reference) => ({
    id: reference.reference_id,
    type: reference.ref_type || "file",
    label: reference.label || reference.file_path || reference.ref_id || "参照",
    filePath: reference.file_path || "",
  });

  const getAgentMessageText = (payload) => {
    const event = payload?.event;
    const item = event?.item;
    if (!item || item.type !== "agent_message") return "";
    return String(item.text || "").trimEnd();
  };

  const summarizeStreamEvent = (payload) => {
    const event = payload?.event;
    const item = event?.item;
    if (!event) return null;
    const id = item?.id || `${event.type}-${Date.now()}`;
    const status = item?.status || event.type;
    if (event.type === "turn.started") {
      return { id: "turn-started", title: "処理を開始しました", detail: "", status: "in_progress" };
    }
    if (event.type === "turn.completed") {
      return { id: "turn-completed", title: "応答をまとめています", detail: "", status: "completed" };
    }
    if (event.type === "turn.failed") {
      return { id: "turn-failed", title: "処理に失敗しました", detail: event.error?.message || "", status: "failed" };
    }
    if (event.type === "error") {
      return { id: "stream-error", title: "エラーが発生しました", detail: event.message || "", status: "failed" };
    }
    if (!item) return null;
    if (item.type === "agent_message") {
      return null;
    }
    if (item.type === "reasoning") {
      return { id, title: "考えを整理しています", detail: item.text || "", status, displayKind: "narrative" };
    }
    if (item.type === "command_execution") {
      const command = item.command ? `$ ${item.command}` : "コマンド実行";
      return {
        id,
        title: item.status === "completed" ? "コマンドを実行しました" : "コマンドを実行中です",
        detail: [command, item.aggregated_output].filter(Boolean).join("\n"),
        status: item.status || status,
        detailKind: "command",
        displayKind: "command",
      };
    }
    if (item.type === "file_change") {
      const changes = Array.isArray(item.changes)
        ? item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n")
        : "";
      return {
        id,
        title: item.status === "completed" ? "ファイル変更が完了しました" : "ファイルを変更しています",
        detail: changes,
        status: item.status || status,
        displayKind: "activity",
      };
    }
    if (item.type === "mcp_tool_call") {
      return {
        id,
        title: item.status === "completed" ? "ツール実行が完了しました" : "ツールを実行しています",
        detail: [item.server, item.tool].filter(Boolean).join(" / "),
        status: item.status || status,
        displayKind: "activity",
      };
    }
    if (item.type === "todo_list") {
      const todoText = Array.isArray(item.items)
        ? item.items.map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`).join("\n")
        : "";
      return { id, title: "作業リストを更新しました", detail: todoText, status, displayKind: "activity" };
    }
    if (item.type === "web_search") {
      return { id, title: "Web検索を実行しています", detail: item.query || "", status, displayKind: "activity" };
    }
    if (item.type === "error") {
      return { id, title: "エラーが発生しました", detail: item.message || "", status: "failed" };
    }
    return { id, title: item.type || event.type, detail: "", status };
  };

  const appendStreamEvent = (current, nextEvent) => {
    if (!nextEvent) return current;
    const renderEvent = {
      ...nextEvent,
      id: `${nextEvent.id}-${Date.now()}-${current.length}`,
    };
    return [...current, renderEvent].slice(-50);
  };

  const streamEventsFromPayloads = (payloads) => {
    const events = [];
    (payloads || []).forEach((payload) => {
      const agentText = getAgentMessageText(payload);
      if (agentText) {
        events.push({
          id: `${payload?.event?.item?.id || "agent-message"}-${events.length}`,
          title: "",
          detail: agentText,
          status: payload?.event?.item?.status || payload?.event?.type || "in_progress",
          displayKind: "narrative",
        });
      }
      const nextEvent = summarizeStreamEvent(payload);
      if (nextEvent) {
        events.push({
          ...nextEvent,
          id: `${nextEvent.id}-${events.length}`,
        });
      }
    });
    return events.slice(-50);
  };

  const appendRunEventPayload = (payload) => {
    const agentText = getAgentMessageText(payload);
    let appendedStreamEvent = false;
    if (agentText) {
      setStreamEvents((current) => appendStreamEvent(current, {
        id: payload?.event?.item?.id || "agent-message",
        title: "",
        detail: agentText,
        status: payload?.event?.item?.status || payload?.event?.type || "in_progress",
        displayKind: "narrative",
      }));
      appendedStreamEvent = true;
    }
    const nextEvent = summarizeStreamEvent(payload);
    if (nextEvent) {
      setStreamEvents((current) => appendStreamEvent(current, nextEvent));
      appendedStreamEvent = true;
    }
    if (appendedStreamEvent) {
      requestScrollMessagesToBottom();
    }
  };

  const toggleStreamEventDetail = (eventId) => {
    setExpandedStreamEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const getWorkdirEntryPath = (entry) => String(entry?.file_path || entry?.id || "");

  const isWorkdirEntryVisible = (entry) => {
    if (sideSearchQuery.trim()) return true;
    const entryPath = getWorkdirEntryPath(entry);
    if (!entryPath || Number(entry.level || 0) === 0) return true;
    const parts = entryPath.split(/[\\/]/).filter(Boolean);
    let currentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}\\${parts[index]}` : parts[index];
      if (!expandedWorkdirPaths.has(currentPath)) return false;
    }
    return true;
  };

  const normalizeSearchValue = (value) => String(value || "").trim().toLowerCase();
  const sideSearchText = normalizeSearchValue(sideSearchQuery);
  const filteredThreads = sideSearchText
    ? threads.filter((thread) => [
      thread.title,
      thread.subtitle,
      thread.id,
      ...(thread.badges || []),
    ].some((value) => normalizeSearchValue(value).includes(sideSearchText)))
    : threads;
  const filteredWorkdirRows = useMemo(() => {
    if (!sideSearchText) return workdirTree.rows;
    const matchingPaths = new Set();
    workdirTree.rows.forEach((entry) => {
      const label = normalizeSearchValue(entry.label);
      const filePath = normalizeSearchValue(entry.file_path);
      if (!label.includes(sideSearchText) && !filePath.includes(sideSearchText)) return;
      const parts = getWorkdirEntryPath(entry).split(/[\\/]/).filter(Boolean);
      let currentPath = "";
      parts.forEach((part) => {
        currentPath = currentPath ? `${currentPath}\\${part}` : part;
        matchingPaths.add(currentPath);
      });
    });
    return workdirTree.rows.filter((entry) => matchingPaths.has(getWorkdirEntryPath(entry)));
  }, [sideSearchText, workdirTree.rows]);
  const visibleWorkdirRows = filteredWorkdirRows.filter(isWorkdirEntryVisible);

  const closeWorkdirContextMenu = () => setWorkdirContextMenu(null);

  const updateContextPanelWidth = (nextWidth) => {
    const clamped = clampContextPanelWidth(nextWidth);
    setContextPanelWidth(clamped);
    try {
      window.localStorage?.setItem(CONTEXT_PANEL_WIDTH_KEY, String(clamped));
    } catch (_error) {
      // 幅の保存に失敗してもドラッグ操作自体は継続する。
    }
  };

  const handleContextPanelResizeStart = (event) => {
    event.preventDefault();
    setIsResizingContextPanel(true);
    const startX = event.clientX;
    const startWidth = contextPanelWidth;

    const handleMove = (moveEvent) => {
      updateContextPanelWidth(startWidth - (moveEvent.clientX - startX));
    };
    const handleUp = () => {
      setIsResizingContextPanel(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const findTask = (taskId) => tasks.find((task) => task.id === taskId) || null;

  const openTaskContext = (taskId) => {
    const task = findTask(taskId);
    setContextPanel({
      type: "task",
      title: task?.title || taskId,
      subtitle: taskId,
      taskId,
      task,
    });
  };

  const getTaskIdFromPath = (filePath) => {
    const name = String(filePath || "").split(/[\\/]/).pop() || "";
    const match = name.match(/^(T-\d{4})\.md$/i);
    return match?.[1] || null;
  };

  const isMarkdownFile = (file) => {
    const extension = String(file?.extension || "").toLowerCase();
    const label = String(file?.label || file?.path || "");
    return extension === ".md" || extension === ".markdown" || /\.(md|markdown)$/i.test(label);
  };

  const openFileContext = async (entry) => {
    if (!entry || entry.type !== "file" || !entry.file_path) return;
    const taskId = getTaskIdFromPath(entry.file_path);
    if (taskId) {
      openTaskContext(taskId);
      return;
    }
    setContextPanel({
      type: "file",
      title: entry.label || entry.file_path,
      subtitle: entry.file_path,
      status: "loading",
      file: null,
    });
    setFilePreviewMode(false);
    try {
      if (!aiChatApi?.previewFile) {
        throw new Error("ファイルプレビューAPIが利用できません。");
      }
      const result = await aiChatApi?.previewFile?.(entry.file_path);
      if (result?.ok === false) throw new Error(result.error || "ファイルを読み込めませんでした。");
      setContextPanel({
        type: "file",
        title: result?.label || entry.label || entry.file_path,
        subtitle: result?.path || entry.file_path,
        status: "ready",
        file: result,
      });
    } catch (error) {
      setContextPanel({
        type: "file",
        title: entry.label || entry.file_path,
        subtitle: entry.file_path,
        status: "error",
        error: error?.message || "ファイルを読み込めませんでした。",
      });
    }
  };

  const refreshThreads = async () => {
    if (!aiChatApi?.listThreads) return [];
    const threadRows = await aiChatApi.listThreads();
    const mapped = Array.isArray(threadRows) ? threadRows.map(mapThread) : [];
    setThreads(mapped);
    return mapped;
  };

  const refreshActiveRuns = async () => {
    if (!aiChatApi?.listActiveRuns) {
      setActiveRuns([]);
      return [];
    }
    const rows = await aiChatApi.listActiveRuns();
    const mapped = Array.isArray(rows) ? rows.filter((run) => run?.thread_id && !run?.canceled) : [];
    setActiveRuns(mapped);
    return mapped;
  };

  const refreshWorkdirTree = async () => {
    if (!aiChatApi?.listWorkdirTree) {
      setWorkdirTree({ rows: [], root: "", truncated: false });
      return [];
    }
    setIsLoadingWorkdirTree(true);
    try {
      const result = await aiChatApi.listWorkdirTree();
      if (result?.ok === false) throw new Error(result.error || "作業フォルダを読み込めませんでした。");
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      setWorkdirTree({
        rows,
        root: result?.root || "",
        truncated: Boolean(result?.truncated),
      });
      setExpandedWorkdirPaths(new Set());
      return rows;
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "作業フォルダを読み込めませんでした。",
      });
      setWorkdirTree({ rows: [], root: "", truncated: false });
      setExpandedWorkdirPaths(new Set());
      return [];
    } finally {
      setIsLoadingWorkdirTree(false);
    }
  };

  const updateScrollBottomButton = () => {
    const element = messageScrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowScrollBottom(distanceFromBottom > 96);
  };

  const scrollMessagesToBottom = (behavior = "smooth") => {
    const element = messageScrollRef.current;
    if (!element) return;
    const scrollBehavior = typeof behavior === "string" ? behavior : "smooth";
    element.scrollTo({ top: element.scrollHeight, behavior: scrollBehavior });
    setShowScrollBottom(false);
  };

  const requestScrollMessagesToBottom = () => {
    pendingAutoScrollRef.current = true;
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (!aiChatApi) return;
      try {
        const settingsResult = await window.cotaskaAPI?.settings?.get?.();
        if (!cancelled && settingsResult?.settings?.aiChat?.sandboxMode) {
          setSandboxMode(normalizeSandboxMode(settingsResult.settings.aiChat.sandboxMode));
        }
        if (!cancelled && settingsResult?.settings?.aiChat?.referenceSendMode === "manual") {
          setReferenceSendMode("skip");
        }
        const isWorkdirConfigured = settingsResult?.configured?.aiChatWorkdir !== false
          && Boolean(String(settingsResult?.settings?.aiChat?.workdir || "").trim());
        const result = await aiChatApi.getDbInfo?.();
        if (cancelled) return;
        setRuntimeState({
          ready: Boolean(result?.ok ?? true),
          status: result?.ok === false ? "error" : (isWorkdirConfigured ? "ready" : "warning"),
          message: !isWorkdirConfigured
            ? "設定の作業フォルダが未設定です。設定画面で作業フォルダを選択してください。"
            : result?.ok === false
            ? (result.error || "AIデータベースの状態確認に失敗しました。")
            : `Codex SDK連携を利用できます。AI DB: ${result?.path || "未確認"}`,
        });
        const mapped = await refreshThreads();
        await refreshActiveRuns();
        if (isWorkdirConfigured) {
          await refreshWorkdirTree();
        } else {
          setWorkdirTree({ rows: [], root: "", truncated: false });
          setExpandedWorkdirPaths(new Set());
        }
        if (cancelled) return;
        setSelectedThreadId((current) => {
          if (current && mapped.some((thread) => thread.id === current)) return current;
          return mapped[0]?.id || null;
        });
      } catch (error) {
        if (cancelled) return;
        setRuntimeState({
          ready: false,
          status: "error",
          message: error?.message || "Codex SDKの状態確認に失敗しました。",
        });
      }
    };
    initialize();
    return () => {
      cancelled = true;
    };
  }, [aiChatApi]);

  useEffect(() => {
    if (!aiChatApi?.onRunEvent) return undefined;
    return aiChatApi.onRunEvent((payload) => {
      if (payload?.thread_id) {
        setActiveRuns((current) => {
          if (current.some((run) => run.request_id === payload.request_id)) {
            return current.map((run) => (
              run.request_id === payload.request_id
                ? {
                  ...run,
                  thread_id: payload.thread_id || run.thread_id,
                  run_id: payload.run_id || run.run_id,
                  last_event_at: new Date().toISOString(),
                  event_count: Number(run.event_count || 0) + 1,
                }
                : run
            ));
          }
          return [
            ...current,
            {
              request_id: payload.request_id,
              thread_id: payload.thread_id,
              run_id: payload.run_id || null,
              last_event_at: new Date().toISOString(),
              event_count: 1,
            },
          ];
        });
      }
      const activeRequest = activeSendRequestRef.current;
      if (!activeRequest?.id || payload?.request_id !== activeRequest.id || activeRequest.canceled) return;
      appendRunEventPayload(payload);
    });
  }, [aiChatApi]);

  useEffect(() => {
    if (!aiChatApi?.listActiveRuns) return undefined;
    const timer = window.setInterval(() => {
      refreshActiveRuns().catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [aiChatApi]);

  useEffect(() => {
    let cancelled = false;
    const hydrateActiveRun = async () => {
      if (!selectedActiveRun?.request_id) {
        const currentActive = activeSendRequestRef.current;
        if (currentActive && (currentActive.thread_id || selectedThreadId)) {
          activeSendRequestRef.current = null;
          setIsSending(false);
          setStreamEvents([]);
          setExpandedStreamEventIds(new Set());
        }
        activeRunHydrationKeyRef.current = "";
        return;
      }

      const hydrateKey = `${selectedActiveRun.request_id}:${selectedThreadId}`;
      activeSendRequestRef.current = {
        id: selectedActiveRun.request_id,
        run_id: selectedActiveRun.run_id || null,
        thread_id: selectedThreadId,
        canceled: false,
      };
      setIsSending(true);
      if (activeRunHydrationKeyRef.current === hydrateKey && streamEvents.length > 0) return;
      activeRunHydrationKeyRef.current = hydrateKey;
      try {
        const payloads = await aiChatApi?.listRunEvents?.({
          request_id: selectedActiveRun.request_id,
          run_id: selectedActiveRun.run_id,
          thread_id: selectedThreadId,
        });
        if (cancelled) return;
        setStreamEvents(streamEventsFromPayloads(Array.isArray(payloads) ? payloads : []));
        setExpandedStreamEventIds(new Set());
        requestScrollMessagesToBottom();
      } catch (_error) {
        if (!cancelled) setStreamEvents([]);
      }
    };
    hydrateActiveRun();
    return () => {
      cancelled = true;
    };
  }, [aiChatApi, selectedActiveRun?.request_id, selectedActiveRun?.run_id, selectedThreadId]);

  useEffect(() => {
    if (sideTab === "files" && workdirTree.rows.length === 0 && !isLoadingWorkdirTree) {
      refreshWorkdirTree();
    }
  }, [sideTab]);

  useEffect(() => {
    const handleAiChatSettingsChanged = (event) => {
      if (event.detail?.sandboxMode) {
        setSandboxMode(normalizeSandboxMode(event.detail.sandboxMode));
      }
    };
    window.addEventListener("cotaska:aiChatSettingsChanged", handleAiChatSettingsChanged);
    return () => window.removeEventListener("cotaska:aiChatSettingsChanged", handleAiChatSettingsChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadThreadData = async () => {
      if (!aiChatApi || !selectedThreadId) {
        setMessages([]);
        setReferences([]);
        return;
      }
      try {
        const [messageRows, referenceRows] = await Promise.all([
          aiChatApi.listMessages?.(selectedThreadId),
          aiChatApi.listReferences?.(selectedThreadId),
        ]);
        if (cancelled) return;
        setMessages(Array.isArray(messageRows) ? messageRows.map(mapMessage) : []);
        setReferences(Array.isArray(referenceRows) ? referenceRows.map(mapReference) : []);
      } catch (error) {
        if (cancelled) return;
        setRuntimeState({
          ready: false,
          status: "error",
          message: error?.message || "AIスレッドの読み込みに失敗しました。",
        });
      }
    };
    loadThreadData();
    return () => {
      cancelled = true;
    };
  }, [aiChatApi, selectedThreadId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (pendingAutoScrollRef.current) {
        scrollMessagesToBottom("auto");
        pendingAutoScrollRef.current = false;
        return;
      }
      updateScrollBottomButton();
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, isSending]);

  useEffect(() => {
    if (!isSending) {
      setWaitingSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    setWaitingSeconds(0);
    const timer = window.setInterval(() => {
      setWaitingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isSending]);

  useEffect(() => {
    if (!workdirContextMenu) return undefined;
    const close = () => closeWorkdirContextMenu();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeWorkdirContextMenu();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [workdirContextMenu]);

  useEffect(() => {
    if (contextPanel?.type !== "task" || !contextPanel.taskId) return;
    const latestTask = findTask(contextPanel.taskId);
    if (!latestTask || latestTask === contextPanel.task) return;
    setContextPanel((current) => (
      current?.type === "task" && current.taskId === contextPanel.taskId
        ? { ...current, title: latestTask.title || current.title, task: latestTask }
        : current
    ));
  }, [tasks, contextPanel?.type, contextPanel?.taskId]);

  useEffect(() => {
    const requestKey = taskChatRequest
      ? `${taskChatRequest.taskId}:${taskChatRequest.requestedAt}`
      : "";
    if (!requestKey || lastTaskChatRequestRef.current === requestKey) return;
    lastTaskChatRequestRef.current = requestKey;
    let cancelled = false;
    const startTaskChat = async () => {
      if (!aiChatApi?.createTaskChatThread) {
        setRuntimeState({
          ready: false,
          status: "error",
          message: "タスク用AIチャット作成APIが利用できません。",
        });
        return;
      }
      try {
        const result = await aiChatApi.createTaskChatThread(taskChatRequest.taskId);
        if (cancelled) return;
        if (!result?.ok || !result.thread?.thread_id) {
          throw new Error(result?.error || "タスク用AIチャットを作成できませんでした。");
        }
        const mappedThreads = await refreshThreads();
        if (cancelled) return;
        const threadId = result.thread.thread_id;
        setSelectedThreadId(threadId);
        if (!mappedThreads.some((thread) => thread.id === threadId)) {
          setThreads((current) => [mapThread(result.thread), ...current]);
        }
        await refreshReferences(threadId);
        if (cancelled) return;
        setRuntimeState((current) => ({
          ...current,
          status: "ready",
          message: `${taskChatRequest.taskId} を参照ファイルに追加したAIチャットを作成しました。`,
        }));
      } catch (error) {
        if (cancelled) return;
        setRuntimeState({
          ready: false,
          status: "error",
          message: error?.message || "タスク用AIチャットを作成できませんでした。",
        });
      }
    };
    startTaskChat();
    return () => {
      cancelled = true;
    };
  }, [aiChatApi, taskChatRequest]);

  const handleNewThread = () => {
    activeSendRequestRef.current = null;
    setSelectedThreadId(null);
    setMessages([]);
    setReferences([]);
    setDraft("");
    setIsSending(false);
    setStreamEvents([]);
    setExpandedStreamEventIds(new Set());
  };

  const handleArchiveThread = async (threadId) => {
    if (!threadId || !aiChatApi?.archiveThread) return;
    try {
      const result = await aiChatApi.archiveThread(threadId);
      if (result?.ok === false) {
        throw new Error(result.error || "AIスレッドをアーカイブできませんでした。");
      }
      const mappedThreads = await refreshThreads();
      if (selectedThreadId === threadId) {
        const nextThreadId = mappedThreads[0]?.id || null;
        setSelectedThreadId(nextThreadId);
        if (!nextThreadId) {
          setMessages([]);
          setReferences([]);
          setContextPanel(null);
        }
      }
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: "AIスレッドをアーカイブしました。",
      }));
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "AIスレッドをアーカイブできませんでした。",
      });
    }
  };

  const ensureThreadForReferences = async () => {
    if (selectedThreadId) return selectedThreadId;
    if (!aiChatApi?.createThread) throw new Error("AIスレッドを作成できません。");
    const result = await aiChatApi.createThread({
      title: draft.trim() ? createDraftThreadTitle(draft) : "参照ファイル付きAIチャット",
    });
    if (!result?.ok || !result.thread?.thread_id) {
      throw new Error(result?.error || "AIスレッドを作成できませんでした。");
    }
    const mappedThreads = await refreshThreads();
    const createdThreadId = result.thread.thread_id;
    setSelectedThreadId(createdThreadId);
    if (!mappedThreads.some((thread) => thread.id === createdThreadId)) {
      setThreads((current) => [mapThread(result.thread), ...current]);
    }
    return createdThreadId;
  };

  const refreshReferences = async (threadId = selectedThreadId) => {
    if (!aiChatApi?.listReferences || !threadId) {
      setReferences([]);
      return [];
    }
    const referenceRows = await aiChatApi.listReferences(threadId);
    const mapped = Array.isArray(referenceRows) ? referenceRows.map(mapReference) : [];
    setReferences(mapped);
    return mapped;
  };

  const addReferenceFiles = async (result) => {
    if (!aiChatApi?.addReference) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: "参照ファイル追加APIが利用できません。",
      });
      return;
    }
    try {
      if (!result?.ok) {
        if (!result?.canceled) {
          setRuntimeState({
            ready: false,
            status: "error",
            message: result?.error || "参照ファイルを選択できませんでした。",
          });
        } else {
          setRuntimeState((current) => ({
            ...current,
            status: "ready",
            message: "参照ファイルの選択をキャンセルしました。",
          }));
        }
        return;
      }
      const threadId = await ensureThreadForReferences();
      const existingPaths = new Set(references.map((reference) => reference.filePath));
      const files = [];
      (result.files || []).forEach((file) => {
        if (!file.file_path || existingPaths.has(file.file_path)) return;
        existingPaths.add(file.file_path);
        files.push(file);
      });
      for (const file of files) {
        const addResult = await aiChatApi.addReference({
          thread_id: threadId,
          ref_type: "file",
          file_path: file.file_path,
          label: file.label || file.file_path,
        });
        if (addResult?.ok === false) {
          throw new Error(addResult.error || `${file.label || file.file_path} を参照ファイルに追加できませんでした。`);
        }
      }
      await refreshReferences(threadId);
      const skippedText = result.skippedCount > 0 ? `（作業フォルダ外の${result.skippedCount}件は除外）` : "";
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: files.length > 0
          ? `参照ファイルを${files.length}件追加しました。${skippedText}`
          : `選択した参照ファイルはすでに追加済みです。${skippedText}`,
      }));
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "参照ファイルの追加に失敗しました。",
      });
    }
  };

  const handleAddReferenceFiles = async () => {
    if (!aiChatApi?.chooseReferenceFiles || !aiChatApi?.addReference) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: "参照ファイル追加APIが利用できません。",
      });
      return;
    }
    try {
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: "参照ファイルを選択してください。",
      }));
      const result = await aiChatApi.chooseReferenceFiles();
      await addReferenceFiles(result);
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "参照ファイルの追加に失敗しました。",
      });
    }
  };

  const handleAddReferenceFromTree = async (entry) => {
    if (!entry || entry.type !== "file" || !entry.file_path || !aiChatApi?.addReference) return;
    try {
      const threadId = await ensureThreadForReferences();
      if (references.some((reference) => reference.filePath === entry.file_path)) {
        setRuntimeState((current) => ({
          ...current,
          status: "ready",
          message: "選択したファイルはすでに参照ファイルに追加済みです。",
        }));
        return;
      }
      const addResult = await aiChatApi.addReference({
        thread_id: threadId,
        ref_type: "file",
        file_path: entry.file_path,
        label: entry.label || entry.file_path,
      });
      if (addResult?.ok === false) {
        throw new Error(addResult.error || `${entry.label || entry.file_path} を参照ファイルに追加できませんでした。`);
      }
      await refreshReferences(threadId);
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: `${entry.label || entry.file_path} を参照ファイルに追加しました。`,
      }));
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "参照ファイルの追加に失敗しました。",
      });
    }
  };

  const handleWorkdirTreeEntryClick = (entry) => {
    if (entry?.type === "directory") {
      const entryPath = getWorkdirEntryPath(entry);
      setExpandedWorkdirPaths((current) => {
        const next = new Set(current);
        if (next.has(entryPath)) {
          next.delete(entryPath);
        } else {
          next.add(entryPath);
        }
        return next;
      });
      return;
    }
    openFileContext(entry);
  };

  const handleReferenceClick = (reference) => {
    if (!reference?.filePath) return;
    openFileContext({
      type: "file",
      file_path: reference.filePath,
      label: reference.label || reference.filePath,
    });
  };

  const handleReferenceKeyDown = (event, reference) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleReferenceClick(reference);
  };

  const handleWorkdirTreeContextMenu = (event, entry) => {
    event.preventDefault();
    event.stopPropagation();
    setWorkdirContextMenu({
      entry,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleWorkdirTreeDragStart = (event, entry) => {
    if (entry?.type !== "file" || !entry.file_path) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-cotaska-workdir-file", JSON.stringify({
      file_path: entry.file_path,
      label: entry.label || entry.file_path,
      type: entry.type,
    }));
    event.dataTransfer.setData("text/plain", entry.file_path);
  };

  const handleComposeDragOver = (event) => {
    const hasWorkdirFile = event.dataTransfer.types.includes("application/x-cotaska-workdir-file");
    const hasExternalFile = event.dataTransfer.types.includes("Files");
    if (!hasWorkdirFile && !hasExternalFile) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsComposeDragOver(true);
  };

  const handleComposeDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsComposeDragOver(false);
  };

  const handleComposeDrop = async (event) => {
    const raw = event.dataTransfer.getData("application/x-cotaska-workdir-file");
    const droppedFiles = Array.from(event.dataTransfer.files || []);
    if (!raw && droppedFiles.length === 0) return;
    event.preventDefault();
    setIsComposeDragOver(false);
    try {
      if (raw) {
        const entry = JSON.parse(raw);
        await handleAddReferenceFromTree(entry);
        return;
      }
      if (!aiChatApi?.normalizeReferenceFiles) {
        throw new Error("外部ファイルの参照追加APIが利用できません。");
      }
      const filePaths = aiChatApi.getDroppedFilePaths
        ? aiChatApi.getDroppedFilePaths(droppedFiles)
        : droppedFiles.map((file) => file.path).filter(Boolean);
      if (filePaths.length === 0) {
        throw new Error("ドラッグしたファイルのパスを取得できませんでした。");
      }
      const result = await aiChatApi.normalizeReferenceFiles(filePaths);
      await addReferenceFiles(result);
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "ドラッグしたファイルを参照ファイルに追加できませんでした。",
      });
    }
  };

  const handleOpenContextFileExternal = async () => {
    const filePath = contextPanel?.file?.path || contextPanel?.subtitle;
    if (!filePath) return;
    try {
      const result = await window.cotaskaAPI?.shell?.openPath?.(filePath);
      if (result?.ok === false) {
        throw new Error(result.error || "外部アプリで開けませんでした。");
      }
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: "外部アプリでファイルを開きました。",
      }));
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "外部アプリで開けませんでした。",
      });
    }
  };

  const handleCopyMessage = async (message) => {
    try {
      await copyTextToClipboard(message.body || "");
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: "チャット内容をコピーしました。",
      }));
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "チャット内容をコピーできませんでした。",
      });
    }
  };

  const runWorkdirEntryAction = async (action) => {
    const entry = workdirContextMenu?.entry;
    closeWorkdirContextMenu();
    if (!entry?.file_path) return;
    try {
      let result = null;
      if (action === "copy") {
        result = await aiChatApi?.copyWorkdirPath?.(entry.file_path);
      } else if (action === "reveal") {
        result = await aiChatApi?.revealWorkdirPath?.(entry.file_path);
      } else if (action === "delete") {
        result = await aiChatApi?.deleteWorkdirPath?.(entry.file_path);
      }
      if (result?.canceled) return;
      if (result?.ok === false) throw new Error(result.error || "操作に失敗しました。");
      if (action === "delete") {
        await refreshWorkdirTree();
        setReferences((current) => current.filter((reference) => (
          reference.filePath !== entry.file_path
          && !reference.filePath.startsWith(`${entry.file_path}\\`)
          && !reference.filePath.startsWith(`${entry.file_path}/`)
        )));
      }
      const messageByAction = {
        copy: "パスをコピーしました。",
        reveal: "エクスプローラで表示しました。",
        delete: "削除しました。",
      };
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: messageByAction[action] || "操作しました。",
      }));
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "操作に失敗しました。",
      });
    }
  };

  const handleRemoveReference = async (referenceId) => {
    if (!aiChatApi?.removeReference) return;
    const result = await aiChatApi.removeReference(referenceId);
    if (result?.ok === false) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: result.error || "参照ファイルを削除できませんでした。",
      });
      return;
    }
    setReferences((current) => current.filter((reference) => reference.id !== referenceId));
  };

  const handleSandboxModeChange = async (event) => {
    const nextMode = normalizeSandboxMode(event.target.value);
    setSandboxMode(nextMode);
    try {
      await window.cotaskaAPI?.settings?.update?.({ aiChat: { sandboxMode: nextMode } });
    } catch {
      // 送信時は画面上の選択値を使うため、設定保存失敗だけではチャット操作を止めない。
    }
  };

  const showLinkOpenError = (target, message) => {
    setContextPanel({
      type: "file",
      title: "リンクを開けませんでした",
      subtitle: target,
      status: "error",
      error: message,
      file: null,
    });
  };

  const handleOpenMarkdownLink = async (href, baseFilePath = "") => {
    const target = String(href || "").trim();
    if (!target) return;
    try {
      if (!aiChatApi?.resolveLinkTarget) {
        throw new Error("リンク先解決APIが利用できません。");
      }
      const resolved = await aiChatApi.resolveLinkTarget(target, baseFilePath);
      if (resolved?.ok === false) throw new Error(resolved.error || "リンク先を解決できませんでした。");
      if (resolved?.target_type === "file") {
        await openFileContext({
          type: "file",
          file_path: resolved.file_path,
          label: resolved.label || resolved.file_path,
        });
        return;
      }
      if (resolved?.target_type !== "url") throw new Error("リンク先の種類を判定できませんでした。");
      const result = await window.cotaskaAPI?.shell?.openTarget?.(resolved.url);
      if (result?.ok === false) throw new Error(result.error || "外部リンクを開けませんでした。");
      setRuntimeState((current) => ({
        ...current,
        status: "ready",
        message: "リンクを外部アプリで開きました。",
      }));
    } catch (error) {
      showLinkOpenError(target, error?.message || "リンクを開けませんでした。");
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "リンクを開けませんでした。",
      });
    }
  };

  const appendAssistantErrorMessage = (message) => {
    requestScrollMessagesToBottom();
    setMessages((current) => [
      ...current,
      {
        id: `error-${Date.now()}`,
        role: "assistant",
        author: "Codex SDK",
        body: message,
        error: true,
      },
    ]);
  };

  const isAiWorkdirConfigured = async () => {
    const settingsResult = await window.cotaskaAPI?.settings?.get?.();
    if (!settingsResult) return true;
    return settingsResult.configured?.aiChatWorkdir !== false
      && Boolean(String(settingsResult.settings?.aiChat?.workdir || "").trim());
  };

  const handleCancelSend = async () => {
    const currentRequest = activeSendRequestRef.current;
    if (!isSending || !currentRequest?.id) return;
    activeSendRequestRef.current = { ...currentRequest, canceled: true };
    setIsSending(false);
    setStreamEvents([]);
    setExpandedStreamEventIds(new Set());
    setRuntimeState((current) => ({
      ...current,
      status: "ready",
      message: "AI処理の中断を要求しました。",
    }));
    requestScrollMessagesToBottom();
    setMessages((current) => [
      ...current.filter((message) => message.id !== currentRequest.streamingAssistantMessageId),
      {
        id: `cancel-${Date.now()}`,
        role: "assistant",
        author: "Codex SDK",
        body: "AI処理の中断を要求しました。",
      },
    ]);
    try {
      const result = await aiChatApi?.cancelRun?.(currentRequest.id);
      await refreshActiveRuns();
      if (result?.ok === false) {
        setRuntimeState((current) => ({
          ...current,
          status: "error",
          message: result.error || "AI処理を中断できませんでした。",
        }));
      }
    } catch (error) {
      setRuntimeState((current) => ({
        ...current,
        status: "error",
        message: error?.message || "AI処理を中断できませんでした。",
      }));
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending) return;
    if (!aiChatApi?.sendMessage) {
      setRuntimeState({
        ready: false,
        status: "unavailable",
        message: "送信先が未接続のため、入力内容は送信されませんでした。",
      });
      return;
    }
    try {
      if (!(await isAiWorkdirConfigured())) {
        setRuntimeState({
          ready: false,
          status: "error",
          message: WORKDIR_REQUIRED_MESSAGE,
          action: null,
        });
        appendAssistantErrorMessage(WORKDIR_REQUIRED_MESSAGE);
        return;
      }
    } catch (error) {
      const message = error?.message || "設定の作業フォルダを確認できませんでした。";
      setRuntimeState({
        ready: false,
        status: "error",
        message,
        action: null,
      });
      appendAssistantErrorMessage(message);
      return;
    }

    const requestId = `ai-send-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const streamingAssistantMessageId = `stream-assistant-${Date.now()}`;
    activeSendRequestRef.current = { id: requestId, canceled: false, streamingAssistantMessageId, thread_id: selectedThreadId || null };
    const pendingUserMessage = {
      id: `pending-user-${Date.now()}`,
      role: "user",
      author: "ユーザー",
      body: text,
      pending: true,
    };

    setDraft("");
    setIsSending(true);
    if (selectedThreadId) {
      setActiveRuns((current) => [
        ...current.filter((run) => run.request_id !== requestId && run.thread_id !== selectedThreadId),
        {
          request_id: requestId,
          thread_id: selectedThreadId,
          run_id: null,
          started_at: new Date().toISOString(),
          last_event_at: null,
          event_count: 0,
        },
      ]);
    }
    setStreamEvents([]);
    setExpandedStreamEventIds(new Set());
    requestScrollMessagesToBottom();
    setMessages((current) => [...current, pendingUserMessage]);
    setRuntimeState((current) => ({
      ...current,
      status: "ready",
      message: "Codex SDKへ送信しました。応答を待っています...",
    }));

    try {
      const effectiveSandboxMode = normalizeSandboxMode(sandboxMode);
      const effectiveReferenceSendMode = normalizeReferenceSendMode(referenceSendMode);
      const result = await aiChatApi.sendMessage({
        thread_id: selectedThreadId || undefined,
        content: text,
        title: selectedThread?.title || createDraftThreadTitle(text),
        sandboxMode: effectiveSandboxMode,
        referenceSendMode: effectiveReferenceSendMode === "default" ? undefined : effectiveReferenceSendMode,
        request_id: requestId,
      });

      const requestState = activeSendRequestRef.current;
      if (requestState?.id !== requestId || requestState.canceled) return;
      const resultMessages = [result?.userMessage, result?.assistantMessage].filter(Boolean).map(mapMessage);
      if (result?.canceled) {
        setRuntimeState({
          ready: true,
          status: "ready",
          message: "AI処理を中断しました。",
          action: null,
        });
      } else if (result?.ok === false) {
        const isAuthError = result.error_kind === "auth";
        setRuntimeState({
          ready: false,
          status: isAuthError ? "auth" : "error",
          message: result.error || "メッセージ送信に失敗しました。",
          action: isAuthError ? "codex-auth-settings" : null,
        });
      } else {
        setRuntimeState({
          ready: true,
          status: "ready",
          message: "Codex SDKの応答を保存しました。",
          action: null,
        });
      }

      if (resultMessages.length > 0) {
        requestScrollMessagesToBottom();
        setMessages((current) => [
          ...current.filter((message) => message.id !== pendingUserMessage.id && message.id !== streamingAssistantMessageId),
          ...resultMessages,
        ]);
      }

      const mappedThreads = await refreshThreads();
      await refreshActiveRuns();
      const nextThreadId = result?.thread?.thread_id || mappedThreads[0]?.id || selectedThreadId || null;
      setSelectedThreadId(nextThreadId);
    } catch (error) {
      const requestState = activeSendRequestRef.current;
      if (requestState?.id !== requestId || requestState.canceled) return;
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "メッセージ送信に失敗しました。",
        action: null,
      });
      requestScrollMessagesToBottom();
      setMessages((current) => [
        ...current.filter((message) => message.id !== pendingUserMessage.id && message.id !== streamingAssistantMessageId),
        pendingUserMessage,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          author: "Codex SDK",
          body: error?.message || "メッセージ送信に失敗しました。",
          error: true,
        },
      ]);
    } finally {
      if (activeSendRequestRef.current?.id === requestId) {
        activeSendRequestRef.current = null;
        setIsSending(false);
        setStreamEvents([]);
        setExpandedStreamEventIds(new Set());
        refreshActiveRuns().catch(() => {});
      }
    }
  };

  return (
    <div
      className={`ai-chat-screen${contextPanel ? " ai-chat-screen--with-context" : ""}${isResizingContextPanel ? " ai-chat-screen--resizing-context" : ""}`}
      style={{ "--ai-context-panel-width": `${contextPanelWidth}px` }}
    >
      <aside className="ai-side-pane">
        <div className="ai-side-head">
          <div className="ai-side-title-row">
            <div className="ai-side-title">AI作業</div>
            <button className="ai-icon-button" type="button" title="新しいスレッド" onClick={handleNewThread}>＋</button>
          </div>
          <div className="ai-search-box">
            <span>⌕</span>
            <input
              type="text"
              value={sideSearchQuery}
              onChange={(event) => setSideSearchQuery(event.target.value)}
              placeholder={sideTab === "files" ? "フォルダ、ファイルを検索" : "スレッドを検索"}
            />
          </div>
          <div className="ai-segmented" role="tablist" aria-label="AI作業サイドペイン">
            <button type="button" className={sideTab === "threads" ? "active" : ""} onClick={() => setSideTab("threads")}>
              スレッド
            </button>
            <button type="button" className={sideTab === "files" ? "active" : ""} onClick={() => setSideTab("files")}>
              フォルダ
            </button>
          </div>
        </div>

        {sideTab === "threads" ? (
          <div className="ai-thread-list">
            <div className="ai-section-label">AIスレッド</div>
            {filteredThreads.length === 0 ? (
              <div className="ai-empty-state">
                <strong>{sideSearchText ? "一致するスレッドはありません" : "スレッドはまだありません"}</strong>
                <span>{sideSearchText ? "検索条件を変更してください。" : "中央の入力欄から送信すると、新しいAIスレッドを作成します。"}</span>
              </div>
            ) : filteredThreads.map((thread) => {
              const isThreadRunning = activeRunByThreadId.has(thread.id);
              return (
                <div
                  key={thread.id}
                  className={`ai-thread-item${selectedThreadId === thread.id ? " active" : ""}${isThreadRunning ? " is-running" : ""}`}
                  onClick={() => setSelectedThreadId(thread.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedThreadId(thread.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="ai-thread-main">
                    <span className="ai-thread-name">{thread.title}</span>
                    <span className="ai-thread-sub">{thread.subtitle}</span>
                  </span>
                  <span className="ai-thread-status" aria-live="polite">
                    {isThreadRunning && (
                      <span
                        className="ai-thread-running-spinner"
                        title="AI処理中"
                        aria-label="AI処理中"
                      />
                    )}
                  </span>
                  <span className="ai-thread-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="ai-thread-action-btn ai-thread-action-btn--archive"
                      title="チャットをアーカイブ"
                      aria-label={`${thread.title}をアーカイブ`}
                      onClick={() => handleArchiveThread(thread.id)}
                    >
                      <span className="ai-thread-archive-icon" aria-hidden="true" />
                    </button>
                  </span>
                  <span className="ai-mini-badges">
                    {thread.badges.map((badge) => <span key={badge}>{badge}</span>)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ai-file-list">
            <div className="ai-file-toolbar">
              <button type="button" onClick={handleAddReferenceFiles}>参照追加</button>
              <button type="button" onClick={refreshWorkdirTree}>更新</button>
            </div>
            {workdirTree.root && (
              <div className="ai-folder-root" title={workdirTree.root}>{workdirTree.root}</div>
            )}
            {isLoadingWorkdirTree ? (
              <div className="ai-empty-state">
                <strong>作業フォルダを読み込んでいます</strong>
                <span>少しお待ちください。</span>
              </div>
            ) : workdirTree.rows.length === 0 ? (
              <div className="ai-empty-state">
                <strong>作業フォルダは空です</strong>
                <span>設定画面の作業フォルダを確認してください。</span>
              </div>
            ) : visibleWorkdirRows.length === 0 ? (
              <div className="ai-empty-state">
                <strong>一致するファイルはありません</strong>
                <span>検索条件を変更してください。</span>
              </div>
            ) : (
              <div className="ai-folder-tree" aria-label="作業フォルダツリー">
                {visibleWorkdirRows.map((entry) => {
                  const entryPath = getWorkdirEntryPath(entry);
                  const isDirectory = entry.type === "directory";
                  const isExpanded = isDirectory && expandedWorkdirPaths.has(entryPath);
                  const isReferenced = references.some((reference) => reference.filePath === entry.file_path);
                  return (
                    <button
                      key={entry.id || entry.file_path}
                      type="button"
                      className={`ai-file-node ai-file-node--${entry.type}${isExpanded ? " expanded" : ""}${isReferenced ? " active" : ""}`}
                      style={{ "--ai-file-level": entry.level || 0 }}
                      title={entry.file_path || entry.label}
                      onClick={() => handleWorkdirTreeEntryClick(entry)}
                      onContextMenu={(event) => handleWorkdirTreeContextMenu(event, entry)}
                      draggable={entry.type === "file"}
                      onDragStart={(event) => handleWorkdirTreeDragStart(event, entry)}
                      aria-expanded={isDirectory ? isExpanded : undefined}
                    >
                      <span className="ai-file-toggle" aria-hidden="true" />
                      <span className="ai-file-kind" aria-hidden="true" />
                      <span className="ai-file-name">{entry.label}</span>
                    </button>
                  );
                })}
                {workdirTree.truncated && (
                  <div className="ai-folder-truncated">表示件数が多いため一部を省略しています。</div>
                )}
                {workdirContextMenu && (
                  <div
                    className="ai-workdir-context-menu"
                    style={{ left: workdirContextMenu.x, top: workdirContextMenu.y }}
                    onClick={(event) => event.stopPropagation()}
                    role="menu"
                  >
                    <button type="button" role="menuitem" onClick={() => runWorkdirEntryAction("copy")}>パスをコピー</button>
                    <button type="button" role="menuitem" onClick={() => runWorkdirEntryAction("reveal")}>エクスプローラで表示する</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => runWorkdirEntryAction("delete")}>削除</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="ai-chat-main">
        <header className="ai-chat-header">
          <div>
            <div className="ai-chat-title">{chatTitle}</div>
            <div className="ai-chat-meta">
              <span className={`ai-status-dot ai-status-dot--${runtimeState.ready ? "ready" : "warn"}`} />
              <span>{runtimeState.ready ? "Codex SDK 接続済み" : "Codex SDK 未接続"}</span>
              {selectedThreadId && <span>{selectedThreadId}</span>}
            </div>
          </div>
          <div className="ai-chat-actions">
            <button className="ai-icon-button" type="button" title="タスクへ戻る">↩</button>
            <button className="ai-icon-button" type="button" title="メニュー">⋯</button>
          </div>
        </header>

        <section
          ref={messageScrollRef}
          className="ai-message-scroll"
          aria-busy={isSending}
          onScroll={updateScrollBottomButton}
        >
          {messages.length === 0 && !isSending ? (
            <div className="ai-chat-empty">
              <strong>AIに相談する内容を入力してください</strong>
              <span>会話履歴、提案、参照ファイルは実データが作成された後に表示されます。</span>
            </div>
          ) : messages.map((message) => (
            <article key={message.id} className={`ai-message ai-message--${message.role}${message.streaming ? " ai-message--streaming" : ""}`}>
              <div className="ai-message-author">{message.author}</div>
              <MarkdownPreview
                content={message.body}
                error={message.error}
                onOpenTask={openTaskContext}
                onOpenLink={handleOpenMarkdownLink}
              />
              <div className="ai-message-hover-actions" aria-label="メッセージ操作">
                {message.time && <time dateTime={message.createdAt}>{message.time}</time>}
                <button
                  type="button"
                  className="ai-message-copy-btn"
                  title="チャット内容をコピー"
                  aria-label="チャット内容をコピー"
                  onClick={() => handleCopyMessage(message)}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
          {isSending && (
            <article className="ai-message ai-message--assistant ai-message--thinking">
              <div className="ai-message-author">Codex SDK</div>
              <div className="ai-thinking">
                <span className="ai-thinking-dot" />
                <span>{streamEvents.length > 0 ? "処理中の内容を受信しています..." : "処理中です。Codex SDKからの応答を待っています..."}</span>
                <span className="ai-thinking-elapsed">待機 {waitingSeconds}秒</span>
              </div>
              {streamEvents.length > 0 && (
                <div className="ai-stream-event-list" aria-label="処理中イベント">
                  {streamEvents.map((event) => (
                    <div key={event.id} className={`ai-stream-event ai-stream-event--${event.displayKind || "activity"} ai-stream-event--${event.status || "active"}`}>
                      {event.title && <div className="ai-stream-event-title">{event.title}</div>}
                      {event.displayKind === "narrative" && event.detail ? (
                        <MarkdownPreview
                          content={event.detail}
                          onOpenTask={openTaskContext}
                          onOpenLink={handleOpenMarkdownLink}
                        />
                      ) : event.detailKind === "command" && event.detail ? (
                        <details
                          className="ai-stream-event-detail"
                          open={expandedStreamEventIds.has(event.id)}
                          onToggle={() => toggleStreamEventDetail(event.id)}
                        >
                          <summary>詳細を表示</summary>
                          <pre>{event.detail}</pre>
                        </details>
                      ) : event.detail && <pre>{event.detail}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          )}
        </section>

        {showScrollBottom && (
          <button
            type="button"
            className="ai-scroll-bottom-button"
            onClick={() => scrollMessagesToBottom()}
            title="一番下までスクロール"
            aria-label="一番下までスクロール"
          >
            ↓
          </button>
        )}

        <footer
          className={`ai-compose${isSending ? " ai-compose--sending" : ""}${isComposeDragOver ? " ai-compose--drag-over" : ""}`}
          onDragOver={handleComposeDragOver}
          onDragLeave={handleComposeDragLeave}
          onDrop={handleComposeDrop}
        >
          <textarea
            value={draft}
            disabled={isSending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") handleSend();
            }}
            placeholder="フォローアップの変更を求める"
          />
          {references.length > 0 && (
            <div className="ai-compose-attachments" aria-label="添付ファイル">
              {references.map((reference) => (
                <span
                  key={reference.id}
                  className="ai-compose-attachment"
                  title={reference.filePath || reference.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleReferenceClick(reference)}
                  onKeyDown={(event) => handleReferenceKeyDown(event, reference)}
                >
                  <span className="ai-compose-attachment-icon">F</span>
                  <span className="ai-compose-attachment-name">{reference.label}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemoveReference(reference.id);
                    }}
                    disabled={isSending}
                    aria-label={`${reference.label}を外す`}
                    title="添付を外す"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="ai-compose-toolbar">
            <button
              type="button"
              className="ai-compose-icon-btn"
              onClick={handleAddReferenceFiles}
              disabled={isSending}
              title="ファイル添付"
              aria-label="ファイル添付"
            >
              ＋
            </button>
            <label className="ai-permission-control" title="権限設定">
              <span>ⓘ</span>
              <select
                value={sandboxMode}
                disabled={isSending}
                aria-label="権限設定"
                onChange={handleSandboxModeChange}
              >
                {SANDBOX_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="ai-permission-control" title="参照ファイル送信">
              <span>添</span>
              <select
                value={referenceSendMode}
                disabled={isSending}
                aria-label="参照ファイル送信"
                onChange={(event) => setReferenceSendMode(normalizeReferenceSendMode(event.target.value))}
              >
                {REFERENCE_SEND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <span className="ai-compose-spacer" />
            <button
              type="button"
              className={`ai-send-button${isSending ? " is-sending" : ""}`}
              onClick={isSending ? handleCancelSend : handleSend}
              disabled={!isSending && !draft.trim()}
              title={isSending ? "中断" : "送信"}
              aria-label={isSending ? "AI処理を中断" : "送信"}
            >
              {isSending ? "■" : "↑"}
            </button>
          </div>
        </footer>
      </main>

      {contextPanel && (
      <aside className="ai-right-pane">
        <div
          className="ai-right-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="コンテキストパネル幅を変更"
          title="ドラッグして幅を変更"
          onMouseDown={handleContextPanelResizeStart}
        />
        <header className="ai-right-header">
          <div>
            <div className="ai-right-title">{contextPanel.title || "コンテキスト"}</div>
            <div className="ai-right-subtitle">{contextPanel.subtitle || ""}</div>
          </div>
          <button className="ai-icon-button" type="button" title="閉じる" onClick={() => setContextPanel(null)}>×</button>
        </header>
        <div className="ai-right-body">
          {contextPanel.type === "task" && (
            <div className="ai-task-detail-panel">
              {contextPanel.task ? (
                <DetailPane
                  key={contextPanel.task.id}
                  task={contextPanel.task}
                  tasks={tasks}
                  lists={lists}
                  tags={tags}
                  onClose={() => setContextPanel(null)}
                  onSelectTask={(task) => openTaskContext(task?.id)}
                  onSaved={onTaskUpdated}
                  onToggleComplete={onToggleComplete}
                  onSetTaskDue={onSetTaskDue}
                  onSetTaskTags={onSetTaskTags}
                  onAddTag={onAddTag}
                />
              ) : (
                <section className="ai-info-card">
                  <p className="ai-muted-text">タスク情報を読み込めませんでした。</p>
                  <button type="button" className="ai-panel-action" onClick={() => onOpenTask?.(contextPanel.taskId)}>
                    リストで開く
                  </button>
                </section>
              )}
            </div>
          )}
          {contextPanel.type === "file" && (
            <section className="ai-file-view-card">
              <div className="ai-file-view-head">
                <h3>ファイルビュー</h3>
                <div className="ai-file-view-actions">
                  {isMarkdownFile(contextPanel.file) && (
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={() => setFilePreviewMode((current) => !current)}
                      title={filePreviewMode ? "テキスト表示へ切替" : "プレビュー表示へ切替"}
                      aria-label={filePreviewMode ? "テキスト表示へ切替" : "プレビュー表示へ切替"}
                    >
                      {filePreviewMode ? "✏" : "🔍"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-action-btn external"
                    onClick={handleOpenContextFileExternal}
                    disabled={!contextPanel.file?.path}
                    title="外部アプリで開く"
                    aria-label="外部アプリで開く"
                  >
                    ↗
                  </button>
                </div>
              </div>
              {contextPanel.status === "loading" && <p>読み込んでいます。</p>}
              {contextPanel.status === "error" && <p className="ai-muted-text">{contextPanel.error}</p>}
              {contextPanel.file?.preview_type === "text" && isMarkdownFile(contextPanel.file) && filePreviewMode && (
                <div className="ai-file-preview-markdown">
                  <MarkdownPreview
                    content={contextPanel.file.content || ""}
                    onOpenTask={openTaskContext}
                    onOpenLink={(href) => handleOpenMarkdownLink(href, contextPanel.file?.path || "")}
                  />
                </div>
              )}
              {contextPanel.file?.preview_type === "text" && (!isMarkdownFile(contextPanel.file) || !filePreviewMode) && (
                <textarea className="ai-file-preview-editor" value={contextPanel.file.content || ""} readOnly />
              )}
              {contextPanel.file?.preview_type === "pdf" && (
                <iframe className="ai-file-preview-pdf" src={contextPanel.file.url} title={contextPanel.file.label || "PDF"} />
              )}
              {contextPanel.file?.preview_type === "unsupported" && (
                <p className="ai-muted-text">このファイル形式はプレビューに対応していません。</p>
              )}
            </section>
          )}
        </div>
      </aside>
      )}
    </div>
  );
}

export default AiChatPane;
