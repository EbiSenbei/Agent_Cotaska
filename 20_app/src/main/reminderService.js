const { Notification } = require("electron");

const CHECK_INTERVAL_MS = 30 * 1000;

let timer = null;
let taskProvider = null;
let settingsProvider = null;
let notifiedKeys = new Set();

function parseDueDateTime(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const [, y, m, d, hh, mm, ss] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss || 0),
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDueTime(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getNotificationSettings() {
  const settings = settingsProvider?.()?.notification;
  const value = Number(settings?.minutesBefore ?? 5);
  return {
    enabled: settings?.enabled !== false,
    dueDateEnabled: settings?.dueDateEnabled !== false,
    deadlineEnabled: settings?.deadlineEnabled === true,
    minutesBefore: Number.isFinite(value) ? Math.max(0, Math.min(1440, Math.round(value))) : 5,
  };
}

function createNotifyKey(task, field, dueAt) {
  return `${task.id}::${field}::${dueAt.toISOString()}`;
}

function runCheck() {
  if (!taskProvider || !Notification.isSupported()) return;
  const settings = getNotificationSettings();
  if (!settings.enabled) return;
  const now = new Date();
  const providedTasks = taskProvider();
  const tasks = Array.isArray(providedTasks) ? providedTasks : [];
  const fields = [
    { field: "due_date", label: "日付", enabled: settings.dueDateEnabled },
    { field: "deadline_date", label: "期限", enabled: settings.deadlineEnabled },
  ];
  const activeKeys = new Set();

  tasks.forEach((task) => {
    if (!task || task.status === "done" || task.progress_status === "完了" || Number(task.delete_flag) === 1) return;
    fields.forEach(({ field, label, enabled }) => {
      const dueAt = parseDueDateTime(task[field]);
      if (!dueAt) return;
      const key = createNotifyKey(task, field, dueAt);
      activeKeys.add(key);
      if (!enabled || notifiedKeys.has(key)) return;
      const remindAt = dueAt.getTime() - settings.minutesBefore * 60 * 1000;
      // 0分設定もポーリングで時刻到達を検出できるよう、1周期だけ受付ける。
      const until = dueAt.getTime() + (settings.minutesBefore === 0 ? CHECK_INTERVAL_MS : 0);
      if (now.getTime() < remindAt || now.getTime() >= until) return;

      const notification = new Notification({
        title: `${settings.minutesBefore === 0 ? "時刻到達" : "まもなく"}${label}: ${task.title || "(無題タスク)"}`,
        body: settings.minutesBefore === 0
          ? `${formatDueTime(dueAt)} になりました。`
          : `${formatDueTime(dueAt)} の${settings.minutesBefore}分前です。`,
        silent: false,
      });
      notification.show();
      notifiedKeys.add(key);
    });
  });

  if (notifiedKeys.size > 10000) {
    notifiedKeys = new Set([...notifiedKeys].filter((key) => activeKeys.has(key)));
  }
}

function start(provider, settingsProviderFn = null) {
  taskProvider = provider;
  settingsProvider = settingsProviderFn;
  runCheck();
  if (timer) clearInterval(timer);
  timer = setInterval(runCheck, CHECK_INTERVAL_MS);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  taskProvider = null;
  settingsProvider = null;
  notifiedKeys.clear();
}

module.exports = {
  start,
  stop,
};
