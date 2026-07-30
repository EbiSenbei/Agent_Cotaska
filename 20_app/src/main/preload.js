const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Renderer プロセスに公開する API を最小限に制限する
// ホワイトリスト方式: ipcRenderer を直接渡さず、呼べるチャンネルを限定する
contextBridge.exposeInMainWorld("cotaskaAPI", {
  // 疎通確認
  ping: () => ipcRenderer.invoke("ping"),

  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo"),
    checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
    openDownloadPage: () => ipcRenderer.invoke("app:openDownloadPage"),
  },

  startup: {
    getProgress: () => ipcRenderer.invoke("startup:getProgress"),
    onProgress: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("startup:progress", listener);
      return () => ipcRenderer.removeListener("startup:progress", listener);
    },
  },

  updates: {
    getStatus: () => ipcRenderer.invoke("updates:getStatus"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStatus: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    },
  },

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch) => ipcRenderer.invoke("settings:update", patch),
    chooseExternalEditor: () => ipcRenderer.invoke("settings:chooseExternalEditor"),
    chooseAiWorkdir: () => ipcRenderer.invoke("settings:chooseAiWorkdir"),
  },

  backup: {
    chooseDirectory: () => ipcRenderer.invoke("backup:chooseDirectory"),
    chooseRestoreDirectory: () => ipcRenderer.invoke("backup:chooseRestoreDirectory"),
    create: (targetDir) => ipcRenderer.invoke("backup:create", targetDir),
    restore: (sourceDir) => ipcRenderer.invoke("backup:restore", sourceDir),
  },

  aiChat: {
    getDbInfo: () => ipcRenderer.invoke("aiChat:getDbInfo"),
    checkAuthStatus: (provider) => ipcRenderer.invoke("aiChat:checkAuthStatus", provider),
    listThreads: (options) => ipcRenderer.invoke("aiChat:listThreads", options),
    createThread: (input) => ipcRenderer.invoke("aiChat:createThread", input),
    updateThread: (threadId, updates) => ipcRenderer.invoke("aiChat:updateThread", threadId, updates),
    archiveThread: (threadId) => ipcRenderer.invoke("aiChat:archiveThread", threadId),
    listMessages: (threadId) => ipcRenderer.invoke("aiChat:listMessages", threadId),
    addMessage: (input) => ipcRenderer.invoke("aiChat:addMessage", input),
    listReferences: (threadId) => ipcRenderer.invoke("aiChat:listReferences", threadId),
    listWorkdirTree: () => ipcRenderer.invoke("aiChat:listWorkdirTree"),
    previewFile: (filePath) => ipcRenderer.invoke("aiChat:previewFile", filePath),
    resolveLinkTarget: (target, baseFilePath) => ipcRenderer.invoke("aiChat:resolveLinkTarget", target, baseFilePath),
    copyWorkdirPath: (filePath) => ipcRenderer.invoke("aiChat:copyWorkdirPath", filePath),
    revealWorkdirPath: (filePath) => ipcRenderer.invoke("aiChat:revealWorkdirPath", filePath),
    deleteWorkdirPath: (filePath) => ipcRenderer.invoke("aiChat:deleteWorkdirPath", filePath),
    chooseReferenceFiles: () => ipcRenderer.invoke("aiChat:chooseReferenceFiles"),
    getDroppedFilePaths: (files) => Array.from(files || [])
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean),
    normalizeReferenceFiles: (filePaths) => ipcRenderer.invoke("aiChat:normalizeReferenceFiles", filePaths),
    addReference: (input) => ipcRenderer.invoke("aiChat:addReference", input),
    createTaskChatThread: (taskId) => ipcRenderer.invoke("aiChat:createTaskChatThread", taskId),
    removeReference: (referenceId) => ipcRenderer.invoke("aiChat:removeReference", referenceId),
    listProposals: (threadId) => ipcRenderer.invoke("aiChat:listProposals", threadId),
    createProposal: (input) => ipcRenderer.invoke("aiChat:createProposal", input),
    updateProposal: (proposalId, updates) => ipcRenderer.invoke("aiChat:updateProposal", proposalId, updates),
    applyProposal: (proposalId) => ipcRenderer.invoke("aiChat:applyProposal", proposalId),
    listRuns: (threadId) => ipcRenderer.invoke("aiChat:listRuns", threadId),
    listActiveRuns: () => ipcRenderer.invoke("aiChat:listActiveRuns"),
    listRunEvents: (input) => ipcRenderer.invoke("aiChat:listRunEvents", input),
    purgeOldData: (days) => ipcRenderer.invoke("aiChat:purgeOldData", days),
    sendMessage: (input) => ipcRenderer.invoke("aiChat:sendMessage", input),
    cancelRun: (requestId) => ipcRenderer.invoke("aiChat:cancelRun", requestId),
    setActiveThread: (threadId) => ipcRenderer.invoke("aiChat:setActiveThread", threadId),
    onOpenThread: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("aiChat:openThread", listener);
      return () => ipcRenderer.removeListener("aiChat:openThread", listener);
    },
    onRunEvent: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("aiChat:runEvent", listener);
      return () => ipcRenderer.removeListener("aiChat:runEvent", listener);
    },
    onThreadUpdated: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("aiChat:threadUpdated", listener);
      return () => ipcRenderer.removeListener("aiChat:threadUpdated", listener);
    },
  },

  // タスク操作（ファイルベース）
  tasks: {
    getAll:           ()                                => ipcRenderer.invoke("tasks:getAll"),
    search:           (keyword)                         => ipcRenderer.invoke("tasks:search", keyword),
    add:              (task)                            => ipcRenderer.invoke("tasks:add",               task),
    update:           (updates)                         => ipcRenderer.invoke("tasks:update",            updates),
    reorder:          (payload)                         => ipcRenderer.invoke("tasks:reorder",           payload),
    updateContent:    (id, content)                     => ipcRenderer.invoke("tasks:updateContent",     id, content),
    completeTask:     (id)                              => ipcRenderer.invoke("tasks:completeTask",      id),
    reopenTask:       (id)                              => ipcRenderer.invoke("tasks:reopenTask",        id),
    trashTask:        (id)                              => ipcRenderer.invoke("tasks:trashTask",         id),
    restoreTask:      (id)                              => ipcRenderer.invoke("tasks:restoreTask",       id),
    deleteTask:       (id)                              => ipcRenderer.invoke("tasks:deleteTask",        id),
    duplicateTask:    (id)                              => ipcRenderer.invoke("tasks:duplicateTask",     id),
    getTrashed:       ()                                => ipcRenderer.invoke("tasks:getTrashed"),
    getCompleted:     ()                                => ipcRenderer.invoke("tasks:getCompleted"),
    getCompletedPage: (options)                         => ipcRenderer.invoke("tasks:getCompletedPage", options),
  },
  detailWindow: {
    open: (taskId) => ipcRenderer.invoke("detailWindow:open", taskId),
    openAiChat: (taskId) => ipcRenderer.invoke("detailWindow:openAiChat", taskId),
    onOpenAiChat: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("detailWindow:openAiChat", listener);
      return () => ipcRenderer.removeListener("detailWindow:openAiChat", listener);
    },
  },

  // リスト操作（YAML ベース）
  lists: {
    getAll:  ()                       => ipcRenderer.invoke("lists:getAll"),
    add:     (list)                   => ipcRenderer.invoke("lists:add",     list),
    update:  (listName, updates)      => ipcRenderer.invoke("lists:update",  listName, updates),
    delete:  (listName)               => ipcRenderer.invoke("lists:delete",  listName),
  },

  // タグ操作（グローバルタグマスタ）
  tags: {
    getAll: ()            => ipcRenderer.invoke("tags:getAll"),
    add:    (name)        => ipcRenderer.invoke("tags:add", name),
    delete: (name)        => ipcRenderer.invoke("tags:delete", name),
  },

  // タスクへのタグ紐付け
  taskTags: {
    set: (taskId, tags) => ipcRenderer.invoke("taskTags:set", taskId, tags),
  },

  // OS 既定アプリでファイルを開く
  shell: {
    openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
    openTarget: (target, baseDir) => ipcRenderer.invoke("shell:openTarget", target, baseDir),
    openTaskFile: (taskId) => ipcRenderer.invoke("shell:openTaskFile", taskId),
    copyTaskFilePath: (taskId) => ipcRenderer.invoke("shell:copyTaskFilePath", taskId),
    openTaskTarget: (taskId, target) => ipcRenderer.invoke("shell:openTaskTarget", taskId, target),
  },

  // イベントリスナー（ファイルウォッチャーから通知）
  onTasksChanged: (callback) => {
    ipcRenderer.on("tasks:changed", (_event, data) => {
      callback(data);
    });
  },

  onDetailContentFontAdjust: (callback) => {
    const listener = (_event, delta) => {
      callback(delta);
    };
    ipcRenderer.on("detail-content-font:adjust", listener);
    return () => {
      ipcRenderer.removeListener("detail-content-font:adjust", listener);
    };
  },

  // リスナー削除
  removeTasksChangedListener: () => {
    ipcRenderer.removeAllListeners("tasks:changed");
  },
});
