import React, { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";

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

function MarkdownPreview({ content, error, onOpenTask }) {
  const html = useMemo(() => markdown.render(String(content || "")), [content]);
  return (
    <div
      className={`ai-message-markdown${error ? " ai-message-error" : ""}`}
      onClick={(event) => {
        const link = event.target.closest?.("[data-task-id]");
        if (!link) return;
        event.preventDefault();
        onOpenTask?.(link.getAttribute("data-task-id"));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function AiChatPane({ tasks = [], onOpenTask }) {
  const messageScrollRef = useRef(null);
  const pendingAutoScrollRef = useRef(false);
  const [sideTab, setSideTab] = useState("threads");
  const [rightTab, setRightTab] = useState("task");
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [references, setReferences] = useState([]);
  const [workdirTree, setWorkdirTree] = useState({ rows: [], root: "", truncated: false });
  const [isLoadingWorkdirTree, setIsLoadingWorkdirTree] = useState(false);
  const [expandedWorkdirPaths, setExpandedWorkdirPaths] = useState(() => new Set());
  const [proposals, setProposals] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [sandboxMode, setSandboxMode] = useState("read-only");
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [workdirContextMenu, setWorkdirContextMenu] = useState(null);
  const [runtimeState, setRuntimeState] = useState({
    ready: false,
    status: "unavailable",
    message: "cotaskaAPI.aiChat はまだ接続されていません。",
  });

  const aiChatApi = useMemo(() => getAiChatApi(), []);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) || null;
  const chatTitle = selectedThread?.title || "新しいAIチャット";

  const mapThread = (thread) => ({
    id: thread.thread_id,
    title: thread.title || "無題のAIチャット",
    subtitle: thread.primary_task_id || thread.change_id || "AIスレッド",
    time: thread.thread_status === "archived" ? "アーカイブ" : "",
    badges: [thread.change_id, thread.primary_task_id, thread.thread_status].filter(Boolean).slice(0, 3),
  });

  const mapMessage = (message) => ({
    id: message.message_id,
    role: message.role === "assistant" ? "assistant" : "user",
    author: message.role === "assistant" ? "Codex SDK" : "ユーザー",
    body: message.error_message || message.content || "",
    error: Boolean(message.error_message),
  });

  const mapProposal = (proposal) => ({
    id: proposal.proposal_id,
    title: proposal.action_type || "提案",
    meta: proposal.target_id || proposal.target_type || "",
    state: proposal.proposal_status || "",
  });

  const mapReference = (reference) => ({
    id: reference.reference_id,
    type: reference.ref_type || "file",
    label: reference.label || reference.file_path || reference.ref_id || "参照",
    filePath: reference.file_path || "",
  });

  const getWorkdirEntryPath = (entry) => String(entry?.file_path || entry?.id || "");

  const isWorkdirEntryVisible = (entry) => {
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

  const visibleWorkdirRows = workdirTree.rows.filter(isWorkdirEntryVisible);

  const closeWorkdirContextMenu = () => setWorkdirContextMenu(null);

  const refreshThreads = async () => {
    if (!aiChatApi?.listThreads) return [];
    const threadRows = await aiChatApi.listThreads();
    const mapped = Array.isArray(threadRows) ? threadRows.map(mapThread) : [];
    setThreads(mapped);
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
    element.scrollTo({ top: element.scrollHeight, behavior });
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
        const result = await aiChatApi.getDbInfo?.();
        if (cancelled) return;
        setRuntimeState({
          ready: Boolean(result?.ok ?? true),
          status: result?.ok === false ? "error" : "ready",
          message: result?.ok === false
            ? (result.error || "AIデータベースの状態確認に失敗しました。")
            : `Codex SDK連携を利用できます。AI DB: ${result?.path || "未確認"}`,
        });
        const mapped = await refreshThreads();
        await refreshWorkdirTree();
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
        setProposals([]);
        return;
      }
      try {
        const [messageRows, proposalRows, referenceRows] = await Promise.all([
          aiChatApi.listMessages?.(selectedThreadId),
          aiChatApi.listProposals?.(selectedThreadId),
          aiChatApi.listReferences?.(selectedThreadId),
        ]);
        if (cancelled) return;
        setMessages(Array.isArray(messageRows) ? messageRows.map(mapMessage) : []);
        setProposals(Array.isArray(proposalRows) ? proposalRows.map(mapProposal) : []);
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

  const handleNewThread = () => {
    setSelectedThreadId(null);
    setMessages([]);
    setReferences([]);
    setProposals([]);
    setDraft("");
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
      const result = await aiChatApi.chooseReferenceFiles();
      if (!result?.ok) {
        if (!result?.canceled) {
          setRuntimeState({
            ready: false,
            status: "error",
            message: result?.error || "参照ファイルを選択できませんでした。",
          });
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
    handleAddReferenceFromTree(entry);
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

    const pendingUserMessage = {
      id: `pending-user-${Date.now()}`,
      role: "user",
      author: "ユーザー",
      body: text,
      pending: true,
    };

    setDraft("");
    setIsSending(true);
    requestScrollMessagesToBottom();
    setMessages((current) => [...current, pendingUserMessage]);
    setRuntimeState((current) => ({
      ...current,
      status: "ready",
      message: "Codex SDKへ送信しました。応答を待っています...",
    }));

    try {
      const effectiveSandboxMode = normalizeSandboxMode(sandboxMode);
      const result = await aiChatApi.sendMessage({
        thread_id: selectedThreadId || undefined,
        content: text,
        title: selectedThread?.title || createDraftThreadTitle(text),
        sandboxMode: effectiveSandboxMode,
      });

      const resultMessages = [result?.userMessage, result?.assistantMessage].filter(Boolean).map(mapMessage);
      if (result?.ok === false) {
        setRuntimeState({
          ready: false,
          status: "error",
          message: result.error || "メッセージ送信に失敗しました。",
        });
      } else {
        setRuntimeState({
          ready: true,
          status: "ready",
          message: "Codex SDKの応答を保存しました。",
        });
      }

      if (resultMessages.length > 0) {
        requestScrollMessagesToBottom();
        setMessages((current) => [
          ...current.filter((message) => message.id !== pendingUserMessage.id),
          ...resultMessages,
        ]);
      }

      const mappedThreads = await refreshThreads();
      const nextThreadId = result?.thread?.thread_id || mappedThreads[0]?.id || selectedThreadId || null;
      setSelectedThreadId(nextThreadId);
      if (nextThreadId && aiChatApi.listProposals) {
        const proposalRows = await aiChatApi.listProposals(nextThreadId);
        setProposals(Array.isArray(proposalRows) ? proposalRows.map(mapProposal) : []);
      }
    } catch (error) {
      setRuntimeState({
        ready: false,
        status: "error",
        message: error?.message || "メッセージ送信に失敗しました。",
      });
      requestScrollMessagesToBottom();
      setMessages((current) => [
        ...current.filter((message) => message.id !== pendingUserMessage.id),
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
      setIsSending(false);
    }
  };

  return (
    <div className="ai-chat-screen">
      <aside className="ai-side-pane">
        <div className="ai-side-head">
          <div className="ai-side-title-row">
            <div className="ai-side-title">AI作業</div>
            <button className="ai-icon-button" type="button" title="新しいスレッド" onClick={handleNewThread}>＋</button>
          </div>
          <div className="ai-search-box">
            <span>⌕</span>
            <input type="text" placeholder="スレッド、ファイルを検索" />
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
            {threads.length === 0 ? (
              <div className="ai-empty-state">
                <strong>スレッドはまだありません</strong>
                <span>中央の入力欄から送信すると、新しいAIスレッドを作成します。</span>
              </div>
            ) : threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`ai-thread-item${selectedThreadId === thread.id ? " active" : ""}`}
                onClick={() => setSelectedThreadId(thread.id)}
              >
                <span className="ai-thread-main">
                  <span className="ai-thread-name">{thread.title}</span>
                  <span className="ai-thread-sub">{thread.subtitle}</span>
                </span>
                <span className="ai-thread-time">{thread.time}</span>
                <span className="ai-mini-badges">
                  {thread.badges.map((badge) => <span key={badge}>{badge}</span>)}
                </span>
              </button>
            ))}
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
            <button className="ai-icon-button" type="button" title="ファイルビューを開く">□</button>
            <button className="ai-icon-button" type="button" title="タスクへ戻る">↩</button>
            <button className="ai-icon-button" type="button" title="メニュー">⋯</button>
          </div>
        </header>

        <div className={`ai-runtime-banner ai-runtime-banner--${runtimeState.status}`}>
          <strong>{runtimeState.ready ? "接続状態" : "確認が必要"}</strong>
          <span>{runtimeState.message}</span>
        </div>

        <div className="ai-context-bar">
          <span>参照中</span>
          {references.length === 0 ? (
            <button type="button" className="muted" onClick={handleAddReferenceFiles}>参照ファイルなし</button>
          ) : references.slice(0, 4).map((reference) => (
            <button key={reference.id} type="button" title={reference.filePath || reference.label}>
              {reference.label}
            </button>
          ))}
          {references.length > 4 && <span>+{references.length - 4}</span>}
          <button type="button" className="ai-context-add" onClick={handleAddReferenceFiles}>＋</button>
        </div>

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
            <article key={message.id} className={`ai-message ai-message--${message.role}`}>
              <div className="ai-message-author">{message.author}</div>
              <MarkdownPreview content={message.body} error={message.error} onOpenTask={onOpenTask} />
            </article>
          ))}
          {isSending && (
            <article className="ai-message ai-message--assistant ai-message--thinking">
              <div className="ai-message-author">Codex SDK</div>
              <div className="ai-thinking">
                <span className="ai-thinking-dot" />
                <span>処理中です。Codex SDKからの応答を待っています...</span>
                <span className="ai-thinking-elapsed">待機 {waitingSeconds}秒</span>
              </div>
            </article>
          )}
        </section>

        {showScrollBottom && (
          <button
            type="button"
            className="ai-scroll-bottom-button"
            onClick={scrollMessagesToBottom}
            title="一番下までスクロール"
            aria-label="一番下までスクロール"
          >
            ↓
          </button>
        )}

        <footer className={`ai-compose${isSending ? " ai-compose--sending" : ""}`}>
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
                <span key={reference.id} className="ai-compose-attachment" title={reference.filePath || reference.label}>
                  <span className="ai-compose-attachment-icon">F</span>
                  <span className="ai-compose-attachment-name">{reference.label}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveReference(reference.id)}
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
            <span className="ai-compose-spacer" />
            <button
              type="button"
              className={`ai-send-button${isSending ? " is-sending" : ""}`}
              onClick={handleSend}
              disabled={isSending || !draft.trim()}
              title={isSending ? "処理中" : "送信"}
              aria-label={isSending ? "処理中" : "送信"}
            >
              {isSending ? "■" : "↑"}
            </button>
          </div>
        </footer>
      </main>

      <aside className="ai-right-pane">
        <header className="ai-right-header">
          <div>
            <div className="ai-right-title">{selectedThread ? selectedThread.title : "詳細ビュー"}</div>
            <div className="ai-right-subtitle">{selectedThread ? selectedThread.subtitle : "スレッド選択後に詳細を表示"}</div>
          </div>
        </header>
        <div className="ai-right-tabs">
          {[
            ["task", "タスク"],
            ["file", "ファイル"],
            ["diff", "差分"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={rightTab === key ? "active" : ""} onClick={() => setRightTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ai-right-body">
          {rightTab === "task" && (
            <>
              <section className="ai-info-card">
                <h3>タスク/提案</h3>
                {selectedThread ? (
                  <dl className="ai-meta-grid">
                    <dt>thread</dt><dd>{selectedThread.id}</dd>
                    <dt>status</dt><dd>{selectedThread.time || "active"}</dd>
                  </dl>
                ) : (
                  <p className="ai-muted-text">スレッドを選択すると、関連タスクやAI提案を表示します。</p>
                )}
              </section>
              <section className="ai-info-card">
                <h3>提案カード</h3>
                {proposals.length === 0 ? (
                  <p className="ai-muted-text">承認待ちの提案はありません。</p>
                ) : (
                  <div className="ai-proposal-list">
                    {proposals.map((proposal) => (
                      <div key={proposal.id} className="ai-proposal-row">
                        <strong>{proposal.title}</strong>
                        <span>{proposal.meta}</span>
                        <em>{proposal.state}</em>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {rightTab === "file" && (
            <section className="ai-markdown-card">
              <h3>参照ファイル</h3>
              {references.length === 0 ? (
                <p>参照ファイルを選択すると、ここに一覧を表示します。</p>
              ) : (
                <div className="ai-reference-detail-list">
                  {references.map((reference) => (
                    <div key={reference.id} className="ai-reference-detail-row">
                      <strong>{reference.label}</strong>
                      <span>{reference.filePath}</span>
                      <button type="button" onClick={() => handleRemoveReference(reference.id)}>外す</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {rightTab === "diff" && (
            <pre className="ai-diff-card">差分はまだありません。</pre>
          )}
        </div>
      </aside>
    </div>
  );
}

export default AiChatPane;
