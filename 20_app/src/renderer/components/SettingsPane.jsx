import React, { useEffect, useRef, useState } from "react";

const SETTINGS_TABS = [
  { id: "app-info", label: "アプリ情報" },
  { id: "settings", label: "設定" },
  { id: "backup", label: "バックアップと復元" },
];

const DEFAULT_APP_INFO = {
  productName: "Cotaska",
  currentVersion: "Cotaska 0.1.0",
  distributionFolder: "Cotaska-Portable",
  updateGuidance: "利用者確認付きの手動ダウンロード案内",
  backupDefaultDir: "",
};

const DEFAULT_SETTINGS = {
  displayName: "Cotaska",
  externalEditorPath: "",
  notification: {
    minutesBefore: 5,
  },
  detailTextSize: 14,
  taskLoading: {
    completedInitialLimit: 100,
    completedLoadMoreLimit: 100,
  },
  aiChat: {
    workdir: "",
    sandboxMode: "read-only",
    performanceMode: "standard",
    diagnosticsEnabled: false,
    retentionDays: 90,
    maxReferenceFiles: 10,
    maxReferenceChars: 100000,
  },
};

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    notification: {
      ...DEFAULT_SETTINGS.notification,
      ...((settings || {}).notification || {}),
    },
    taskLoading: {
      ...DEFAULT_SETTINGS.taskLoading,
      ...((settings || {}).taskLoading || {}),
    },
    aiChat: {
      ...DEFAULT_SETTINGS.aiChat,
      ...((settings || {}).aiChat || {}),
    },
  };
}

function formatCheckedAt(value) {
  if (!value) return "未確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未確認";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getAuthGuide(status) {
  if (status === "available") return "Codexを利用できる認証状態です。";
  if (status === "sdk_missing") return "Cotaskaの依存関係を確認してください。配布版ではCodex SDKを同梱する想定です。";
  if (status === "cli_unavailable") return "Codex CLIを実行できません。インストール状態、ウイルス対策ソフト、実行権限を確認してください。";
  if (status === "login_required") return "ターミナルで codex login を実行し、ブラウザでログインを完了してから再確認してください。";
  if (status === "expired_possible") return "Codexの認証情報が期限切れ、無効、または権限不足の可能性があります。codex login で再ログインしてから再確認してください。";
  return "状態を確認できませんでした。Codexのログイン状態とネットワークを確認してから再確認してください。";
}

function SettingsPane({ focusRequest }) {
  const [activeTab, setActiveTab] = useState("app-info");
  const [appInfo, setAppInfo] = useState(DEFAULT_APP_INFO);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsPath, setSettingsPath] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState({
    status: "idle",
    message: "",
    hasUpdate: false,
    downloaded: false,
    progress: null,
  });
  const [backupDir, setBackupDir] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [backupError, setBackupError] = useState("");
  const [restoreDir, setRestoreDir] = useState("");
  const [restoreStatus, setRestoreStatus] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [aiCleanupStatus, setAiCleanupStatus] = useState("");
  const [aiCleanupError, setAiCleanupError] = useState("");
  const [authStatus, setAuthStatus] = useState({
    status: "unknown",
    label: "未確認",
    message: "まだ確認していません。",
    checkedAt: null,
    needsLogin: false,
  });
  const [checkingAuth, setCheckingAuth] = useState(false);
  const authSectionRef = useRef(null);

  const refreshAppInfo = async () => {
    const info = await window.cotaskaAPI?.app?.getInfo?.();
    if (info) {
      setAppInfo({ ...DEFAULT_APP_INFO, ...info });
      if (info.downloadPageUrl) setUpdateUrl(info.downloadPageUrl);
      if (info.backupDefaultDir) {
        setBackupDir((current) => current || info.backupDefaultDir);
      }
    }
  };

  const loadSettings = async () => {
    const result = await window.cotaskaAPI?.settings?.get?.();
    if (result?.settings) {
      const normalized = normalizeSettings(result.settings);
      setSettings(normalized);
      window.localStorage?.setItem("cotaska.detailContentFontSize", String(normalized.detailTextSize));
    }
    if (result?.path) setSettingsPath(result.path);
    if (result && result.ok === false) setErrorMessage(result.error || "設定を読み込めませんでした。");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshAppInfo();
      if (!cancelled) await loadSettings();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (focusRequest?.target !== "codex-auth") return;
    setActiveTab("settings");
    window.setTimeout(() => {
      authSectionRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 80);
  }, [focusRequest]);

  useEffect(() => {
    let cancelled = false;
    const applyStatus = (status) => {
      if (!status || cancelled) return;
      setUpdaterStatus((current) => ({ ...current, ...status }));
      if (status.message) setUpdateStatus(status.message);
      setDownloadingUpdate(status.status === "downloading");
    };

    window.cotaskaAPI?.updates?.getStatus?.().then(applyStatus);
    const unsubscribe = window.cotaskaAPI?.updates?.onStatus?.(applyStatus);
    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const updateSettingState = (patch) => {
    setSettings((current) => normalizeSettings({
      ...current,
      ...patch,
      notification: {
        ...current.notification,
        ...(patch.notification || {}),
      },
      taskLoading: {
        ...current.taskLoading,
        ...(patch.taskLoading || {}),
      },
      aiChat: {
        ...current.aiChat,
        ...(patch.aiChat || {}),
      },
    }));
  };

  const saveSettings = async () => {
    setStatusMessage("");
    setErrorMessage("");
    const result = await window.cotaskaAPI?.settings?.update?.(settings);
    if (!result?.ok) {
      setErrorMessage(result?.error || "設定を保存できませんでした。");
      return;
    }

    const normalized = normalizeSettings(result.settings);
    setSettings(normalized);
    setSettingsPath(result.path || settingsPath);
    window.localStorage?.setItem("cotaska.detailContentFontSize", String(normalized.detailTextSize));
    window.dispatchEvent(new CustomEvent("cotaska:detailTextSizeChanged", { detail: normalized.detailTextSize }));
    window.dispatchEvent(new CustomEvent("cotaska:aiChatSettingsChanged", { detail: normalized.aiChat }));
    setStatusMessage("設定を保存しました。");
    await refreshAppInfo();
  };

  const chooseExternalEditor = async () => {
    const result = await window.cotaskaAPI?.settings?.chooseExternalEditor?.();
    if (result?.ok && result.path) {
      updateSettingState({ externalEditorPath: result.path });
    }
  };

  const chooseAiWorkdir = async () => {
    const result = await window.cotaskaAPI?.settings?.chooseAiWorkdir?.();
    if (result?.ok && result.path) {
      updateSettingState({ aiChat: { workdir: result.path } });
    }
  };

  const purgeOldAiData = async () => {
    setAiCleanupStatus("");
    setAiCleanupError("");
    const days = Number(settings.aiChat.retentionDays || 90);
    if (!window.confirm(`${days}日以前のアーカイブ済みAIデータを完全削除します。タスク本体は削除されません。続行しますか？`)) return;
    const result = await window.cotaskaAPI?.aiChat?.purgeOldData?.(days);
    if (!result?.ok) {
      setAiCleanupError(result?.error || "AIデータ削除に失敗しました。");
      return;
    }
    setAiCleanupStatus(`AIデータを削除しました。削除スレッド数: ${result.deletedThreads ?? 0}`);
  };

  const checkCodexAuthStatus = async () => {
    setCheckingAuth(true);
    setErrorMessage("");
    try {
      const result = await window.cotaskaAPI?.aiChat?.checkAuthStatus?.();
      setAuthStatus({
        status: result?.status || "error",
        label: result?.label || "確認失敗",
        message: result?.message || "Codex認証状態を確認できませんでした。",
        checkedAt: result?.checkedAt || new Date().toISOString(),
        needsLogin: Boolean(result?.needsLogin),
        version: result?.version || null,
      });
    } catch (error) {
      setAuthStatus({
        status: "error",
        label: "確認失敗",
        message: error?.message || "Codex認証状態を確認できませんでした。",
        checkedAt: new Date().toISOString(),
        needsLogin: false,
      });
    } finally {
      setCheckingAuth(false);
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus("");
    setErrorMessage("");
    let autoUpdateResult = null;
    try {
      if (window.cotaskaAPI?.updates?.check) {
        const result = await window.cotaskaAPI.updates.check();
        if (result) {
          autoUpdateResult = result;
          setUpdaterStatus((current) => ({ ...current, ...result }));
          if (result.status && result.status !== "unsupported") {
            setUpdateStatus(result.message || "更新確認が完了しました。");
            return;
          }
        }
      }

      const result = await window.cotaskaAPI?.app?.checkForUpdates?.();
      if (result?.downloadPageUrl) setUpdateUrl(result.downloadPageUrl);
      if (result?.ok && result?.hasUpdate && autoUpdateResult?.status === "unsupported") {
        setUpdateStatus("新しいバージョンがあります。この実行形態では自動ダウンロードに対応していません。下の「ダウンロードページを開く」から更新してください。");
      } else {
        setUpdateStatus(result?.ok
          ? (result.message || "更新確認が完了しました。")
          : (result?.error || "更新確認に失敗しました。"));
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const downloadUpdate = async () => {
    if (!window.confirm("更新ファイルをダウンロードしますか？")) return;
    setDownloadingUpdate(true);
    const result = await window.cotaskaAPI?.updates?.download?.();
    if (result) {
      setUpdaterStatus((current) => ({ ...current, ...result }));
      setUpdateStatus(result.message || "更新ダウンロードを開始しました。");
    }
    setDownloadingUpdate(false);
  };

  const installUpdate = async () => {
    if (!window.confirm("Cotaskaを再起動して更新を適用しますか？")) return;
    const result = await window.cotaskaAPI?.updates?.install?.();
    if (result) {
      setUpdaterStatus((current) => ({ ...current, ...result }));
      setUpdateStatus(result.message || "再起動して更新を適用します。");
    }
  };

  const openDownloadPage = async () => {
    const targetUrl = updateUrl || appInfo.downloadPageUrl;
    if (!window.confirm("ダウンロードページをブラウザで開きますか？")) return;
    const result = await window.cotaskaAPI?.app?.openDownloadPage?.(targetUrl);
    if (!result?.ok) {
      setUpdateStatus(result?.error || "ダウンロードページを開けませんでした。");
    }
  };

  const chooseBackupDirectory = async () => {
    const result = await window.cotaskaAPI?.backup?.chooseDirectory?.();
    if (result?.ok && result.path) {
      setBackupDir(result.path);
      setBackupError("");
    }
  };

  const chooseRestoreDirectory = async () => {
    const result = await window.cotaskaAPI?.backup?.chooseRestoreDirectory?.();
    if (result?.ok && result.path) {
      setRestoreDir(result.path);
      setRestoreError("");
    }
  };

  const createBackup = async () => {
    setBackupStatus("");
    setBackupError("");
    const result = await window.cotaskaAPI?.backup?.create?.(backupDir);
    if (!result?.ok) {
      setBackupError(result?.error || "バックアップを作成できませんでした。");
      return;
    }
    setBackupStatus(`バックアップを作成しました: ${result.backupPath}`);
  };

  const restoreBackup = async () => {
    setRestoreStatus("");
    setRestoreError("");
    if (!restoreDir.trim()) {
      setRestoreError("復元元バックアップzipを選択してください。");
      return;
    }
    if (!window.confirm("現在のタスク、リスト、設定を選択したバックアップで復元します。復元前バックアップを作成してから実行します。続行しますか？")) return;
    const result = await window.cotaskaAPI?.backup?.restore?.(restoreDir);
    if (!result?.ok) {
      setRestoreError(result?.error || "バックアップを復元できませんでした。");
      return;
    }
    setRestoreStatus(`復元しました: ${result.restoredFrom} / 復元前バックアップ: ${result.preRestoreBackupPath}`);
    await loadSettings();
  };

  const canDownloadUpdate = updaterStatus.status === "available" && !downloadingUpdate;
  const canInstallUpdate = updaterStatus.downloaded || updaterStatus.status === "downloaded";
  const progressPercent = Math.max(0, Math.min(100, Math.round(updaterStatus.progress?.percent || 0)));

  return (
    <div className="settings-screen">
      <aside className="settings-side-panel" aria-label="設定項目">
        <h1 className="settings-side-title">設定</h1>
        <div className="settings-side-label">MENU</div>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-side-item${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </aside>

      <main className="settings-main">
        {activeTab === "app-info" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">アプリ情報</h2>
                <p className="settings-page-subtitle">現在の Cotaska と更新情報を確認します。</p>
              </div>
            </div>

            <div className="settings-section app-info-card">
              <div className="app-info-logo">C</div>
              <div>
                <div className="app-info-name">{appInfo.productName}</div>
                <div className="app-info-version">{appInfo.currentVersion}</div>
              </div>
              <button type="button" className="settings-primary-btn" onClick={checkForUpdates} disabled={checkingUpdate}>
                {checkingUpdate ? "確認中..." : "更新を確認"}
              </button>
            </div>

            <div className="settings-section update-guide-card">
              <div>
                <div className="update-guide-title">更新案内</div>
                <div className="update-guide-text">{updateStatus || appInfo.updateGuidance}</div>
                {updaterStatus.status === "downloading" && (
                  <div className="update-progress" aria-label="更新ダウンロード進捗">
                    <div className="update-progress-bar" style={{ width: `${progressPercent}%` }} />
                  </div>
                )}
                <div className="update-guide-note">確認後に更新をダウンロードし、再起動時に適用します。利用できない環境では手動ダウンロードを案内します。</div>
              </div>
              <div className="update-action-row">
                <button
                  type="button"
                  className="settings-secondary-btn"
                  onClick={downloadUpdate}
                  disabled={!canDownloadUpdate}
                >
                  {downloadingUpdate ? "ダウンロード中..." : "更新をダウンロード"}
                </button>
                <button
                  type="button"
                  className="settings-primary-btn"
                  onClick={installUpdate}
                  disabled={!canInstallUpdate}
                >
                  再起動して更新
                </button>
                <button type="button" className="settings-secondary-btn" onClick={openDownloadPage}>
                  ダウンロードページを開く
                </button>
              </div>
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">設定</h2>
                <p className="settings-page-subtitle">表示、外部アプリ、通知、AI Agent の接続先を設定します。</p>
              </div>
              <button type="button" className="settings-primary-btn" onClick={saveSettings}>保存</button>
            </div>

            {(statusMessage || errorMessage) && (
              <div className={`settings-message ${errorMessage ? "settings-message--error" : "settings-message--success"}`}>
                {errorMessage || statusMessage}
              </div>
            )}

            <div className="settings-section">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>表示名</th>
                    <td>
                      <input
                        className="settings-text-input"
                        type="text"
                        value={settings.displayName}
                        maxLength={40}
                        aria-label="表示名"
                        onChange={(e) => updateSettingState({ displayName: e.target.value })}
                      />
                      <div className="settings-help-text">Cotaska の画面タイトルやアプリ情報に表示する名前。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>外部エディタ</th>
                    <td>
                      <div className="settings-field-row">
                        <input
                          className="settings-text-input settings-path-input"
                          type="text"
                          value={settings.externalEditorPath}
                          aria-label="外部エディタ"
                          onChange={(e) => updateSettingState({ externalEditorPath: e.target.value })}
                        />
                        <button type="button" className="settings-secondary-btn" onClick={chooseExternalEditor}>参照</button>
                      </div>
                      <div className="settings-help-text">空欄の場合は .md ファイルの既定のアプリが起動します。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>通知時間</th>
                    <td>
                      <div className="settings-unit-field">
                        <input
                          className="settings-number-input"
                          type="number"
                          value={settings.notification.minutesBefore}
                          min="0"
                          max="1440"
                          step="1"
                          aria-label="通知時間"
                          onChange={(e) => updateSettingState({ notification: { minutesBefore: e.target.value } })}
                        />
                        <span className="settings-unit-label">分</span>
                      </div>
                      <div className="settings-help-text">タスクの日時が近い場合の、事前通知の時間。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>文字サイズ</th>
                    <td>
                      <div className="settings-unit-field">
                        <input
                          className="settings-number-input"
                          type="number"
                          value={settings.detailTextSize}
                          min="10"
                          max="28"
                          step="1"
                          aria-label="文字サイズ"
                          onChange={(e) => updateSettingState({ detailTextSize: e.target.value })}
                        />
                        <span className="settings-unit-label">px</span>
                      </div>
                      <div className="settings-help-text">タスク詳細の文字サイズ。ショートカット操作でも同じ設定値を更新します。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>完了タスク読込</th>
                    <td>
                      <div className="settings-task-loading-row">
                        <div className="settings-unit-field settings-compact-unit-field">
                          <span className="settings-inline-label">起動時</span>
                          <input
                            className="settings-number-input settings-compact-number-input"
                            type="number"
                            value={settings.taskLoading.completedInitialLimit}
                            min="0"
                            max="1000"
                            step="10"
                            aria-label="起動時に読み込む完了タスク件数"
                            onChange={(e) => updateSettingState({ taskLoading: { completedInitialLimit: e.target.value } })}
                          />
                          <span className="settings-unit-label">件</span>
                        </div>
                        <div className="settings-unit-field settings-compact-unit-field">
                          <span className="settings-inline-label">追加読込</span>
                          <input
                            className="settings-number-input settings-compact-number-input"
                            type="number"
                            value={settings.taskLoading.completedLoadMoreLimit}
                            min="1"
                            max="1000"
                            step="10"
                            aria-label="次を読み込む件数"
                            onChange={(e) => updateSettingState({ taskLoading: { completedLoadMoreLimit: e.target.value } })}
                          />
                          <span className="settings-unit-label">件</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <th>作業フォルダ</th>
                    <td>
                      <div className="settings-field-row">
                        <input
                          className="settings-text-input settings-path-input"
                          type="text"
                          value={settings.aiChat.workdir}
                          aria-label="作業フォルダ"
                          onChange={(e) => updateSettingState({ aiChat: { workdir: e.target.value } })}
                        />
                        <button type="button" className="settings-secondary-btn" onClick={chooseAiWorkdir}>参照</button>
                      </div>
                      <div className="settings-help-text">ファイルツリー表示とAI実行時の作業フォルダ。APIキーはCotaskaに保存しません。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>権限</th>
                    <td>
                      <select
                        className="settings-select-input"
                        value={settings.aiChat.sandboxMode}
                        aria-label="AI実行権限"
                        onChange={(e) => updateSettingState({ aiChat: { sandboxMode: e.target.value } })}
                      >
                        <option value="read-only">読み取り専用</option>
                        <option value="workspace-write">作業フォルダへ書き込み可</option>
                        <option value="danger-full-access">フルアクセス</option>
                      </select>
                      <div className="settings-help-text">Codex SDK実行時の既定権限。チャット入力欄でも送信前に一時変更できます。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>AI速度</th>
                    <td>
                      <select
                        className="settings-select-input"
                        value={settings.aiChat.performanceMode}
                        aria-label="AI速度モード"
                        onChange={(e) => updateSettingState({ aiChat: { performanceMode: e.target.value } })}
                      >
                        <option value="standard">標準</option>
                        <option value="speed">速度優先</option>
                      </select>
                      <div className="settings-help-text">速度優先ではFast mode設定と短命Codex実行を使い、Codex側の履歴肥大化を抑えます。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>AI診断ログ</th>
                    <td>
                      <label className="settings-checkbox-row">
                        <input
                          type="checkbox"
                          checked={Boolean(settings.aiChat.diagnosticsEnabled)}
                          onChange={(e) => updateSettingState({ aiChat: { diagnosticsEnabled: e.target.checked } })}
                        />
                        <span>応答速度調査用の詳細ログを出力する</span>
                      </label>
                      <div className="settings-help-text">通常はOFF。ONにするとAI応答時間、トークン数、Codexスレッド戦略などをアプリログへ出力します。</div>
                    </td>
                  </tr>
                  <tr ref={authSectionRef} id="codex-auth-settings">
                    <th>Codex認証状態</th>
                    <td>
                      <div className="settings-auth-panel">
                        <div className={`settings-auth-badge settings-auth-badge--${authStatus.status}`}>
                          {authStatus.label}
                        </div>
                        <div className="settings-auth-body">
                          <div className="settings-auth-message">{authStatus.message}</div>
                          <div className="settings-help-text">最終確認: {formatCheckedAt(authStatus.checkedAt)}</div>
                          {authStatus.version && <div className="settings-help-text">Codex CLI: {authStatus.version}</div>}
                          <div className="settings-help-text">{getAuthGuide(authStatus.status)}</div>
                          <div className="settings-help-text">CotaskaはOpenAI APIキー、Codex access token、Codex認証ファイルの内容を保存しません。</div>
                        </div>
                        <button
                          type="button"
                          className="settings-secondary-btn"
                          onClick={checkCodexAuthStatus}
                          disabled={checkingAuth}
                        >
                          {checkingAuth ? "確認中..." : "再確認"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <th>AI参照上限</th>
                    <td>
                      <div className="settings-task-loading-row">
                        <div className="settings-unit-field settings-compact-unit-field">
                          <span className="settings-inline-label">ファイル</span>
                          <input
                            className="settings-number-input settings-compact-number-input"
                            type="number"
                            value={settings.aiChat.maxReferenceFiles}
                            min="1"
                            max="100"
                            step="1"
                            aria-label="AI参照ファイル最大件数"
                            onChange={(e) => updateSettingState({ aiChat: { maxReferenceFiles: e.target.value } })}
                          />
                          <span className="settings-unit-label">件</span>
                        </div>
                        <div className="settings-unit-field settings-compact-unit-field">
                          <span className="settings-inline-label">合計</span>
                          <input
                            className="settings-number-input settings-compact-number-input"
                            type="number"
                            value={settings.aiChat.maxReferenceChars}
                            min="1000"
                            max="1000000"
                            step="1000"
                            aria-label="AI参照ファイル合計文字数"
                            onChange={(e) => updateSettingState({ aiChat: { maxReferenceChars: e.target.value } })}
                          />
                          <span className="settings-unit-label">文字</span>
                        </div>
                      </div>
                      <div className="settings-help-text">Codexへ渡す参照ファイルの上限。初期値は10件、100,000文字。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>AIデータ削除</th>
                    <td>
                      <div className="settings-task-loading-row">
                        <div className="settings-unit-field settings-compact-unit-field">
                          <span className="settings-inline-label">保持</span>
                          <input
                            className="settings-number-input settings-compact-number-input"
                            type="number"
                            value={settings.aiChat.retentionDays}
                            min="1"
                            max="3650"
                            step="1"
                            aria-label="AIデータ保持日数"
                            onChange={(e) => updateSettingState({ aiChat: { retentionDays: e.target.value } })}
                          />
                          <span className="settings-unit-label">日</span>
                        </div>
                        <button type="button" className="settings-secondary-btn" onClick={purgeOldAiData}>
                          古いAIデータを削除
                        </button>
                      </div>
                      <div className="settings-help-text">指定日数以前のアーカイブ済みAIスレッドと関連履歴を削除します。タスク本体は削除しません。</div>
                      {(aiCleanupStatus || aiCleanupError) && (
                        <div className={`settings-message ${aiCleanupError ? "settings-message--error" : "settings-message--success"}`}>
                          {aiCleanupError || aiCleanupStatus}
                        </div>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {settingsPath && <div className="settings-file-path">設定ファイル: {settingsPath}</div>}
          </section>
        )}

        {activeTab === "backup" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">バックアップと復元</h2>
                <p className="settings-page-subtitle">タスク正本、リスト、設定ファイルを手動バックアップします。</p>
              </div>
            </div>

            <div className="settings-section backup-panel">
              <div className="settings-subsection-title">バックアップ</div>
              <div className="settings-field-row">
                <input
                  className="settings-text-input settings-path-input"
                  type="text"
                  value={backupDir}
                  aria-label="バックアップ保存先"
                  onChange={(e) => setBackupDir(e.target.value)}
                />
                <button type="button" className="settings-secondary-btn" onClick={chooseBackupDirectory}>保存先</button>
              </div>
              <div className="settings-help-text">
                既定では Cotaska.exe と同じフォルダの `backup` に保存します。`data/tasks`、`data/lists.yaml`、`data/settings.yaml` をタイムスタンプ付きzipにまとめます。
              </div>
              <button type="button" className="settings-primary-btn backup-create-btn" onClick={createBackup}>
                バックアップ作成
              </button>
              {(backupStatus || backupError) && (
                <div className={`settings-message ${backupError ? "settings-message--error" : "settings-message--success"}`}>
                  {backupError || backupStatus}
                </div>
              )}
              <div className="settings-divider" />
              <div className="settings-subsection-title">復元</div>
              <div className="settings-field-row">
                <input
                  className="settings-text-input settings-path-input"
                  type="text"
                  value={restoreDir}
                  aria-label="復元元バックアップzip"
                  onChange={(e) => setRestoreDir(e.target.value)}
                />
                <button type="button" className="settings-secondary-btn" onClick={chooseRestoreDirectory}>zip選択</button>
              </div>
              <div className="settings-help-text">
                選択したバックアップzip内の `data/tasks`、`data/lists.yaml`、`data/settings.yaml` を復元します。実行前に現在のデータを `backup` 配下へ退避します。
              </div>
              <button type="button" className="settings-secondary-btn backup-create-btn" onClick={restoreBackup}>
                バックアップから復元
              </button>
              {(restoreStatus || restoreError) && (
                <div className={`settings-message ${restoreError ? "settings-message--error" : "settings-message--success"}`}>
                  {restoreError || restoreStatus}
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default SettingsPane;
