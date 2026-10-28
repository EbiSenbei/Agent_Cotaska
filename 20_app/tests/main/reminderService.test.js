const fs = require("fs");
const path = require("path");
const vm = require("vm");

let service, shown, notification, tasks;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 28, 12, 0, 0));
  shown = [];
  notification = { enabled: true, dueDateEnabled: true, deadlineEnabled: false, minutesBefore: 5 };
  tasks = [{ id: "T-1", title: "テスト", due_date: "2026-10-28T12:05:00", deadline_date: "2026-10-28T12:05:00" }];
  class Notification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; }
    show() { shown.push(this.options); }
  }
  const context = { module: { exports: {} }, require: () => ({ Notification }), Date, Set, setInterval, clearInterval };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../src/main/reminderService.js"), "utf8"), context);
  service = context.module.exports;
});
afterEach(() => { service.stop(); vi.useRealTimers(); });
function start() { service.start(() => tasks, () => ({ notification })); }

test("旧設定は日付だけ通知し、繰り返さない", () => {
  notification = { minutesBefore: 5 };
  start();
  expect(shown).toHaveLength(1);
  expect(shown[0].title).toContain("日付");
  vi.advanceTimersByTime(60000);
  expect(shown).toHaveLength(1);
});
test.each([
  [false, true, true, []],
  [true, false, false, []],
  [true, false, true, ["期限"]],
  [true, true, false, ["日付"]],
  [true, true, true, ["日付", "期限"]],
])("通知切替 %s / %s / %s", (enabled, dueDateEnabled, deadlineEnabled, expected) => {
  Object.assign(notification, { enabled, dueDateEnabled, deadlineEnabled });
  start();
  expect(shown).toHaveLength(expected.length);
  expected.forEach((label, i) => expect(shown[i].title).toContain(label));
});
test("保存済み設定の変更を次回判定で反映する", () => {
  notification.enabled = false;
  start();
  notification.enabled = true;
  notification.dueDateEnabled = false;
  notification.deadlineEnabled = true;
  vi.advanceTimersByTime(30000);
  expect(shown).toHaveLength(1);
  expect(shown[0].title).toContain("期限");
});
test.each([
  { status: "done" }, { progress_status: "完了" }, { delete_flag: 1 },
  { due_date: "2026-10-28" }, { due_date: null }, { due_date: "invalid" },
  { due_date: "2026-10-28T11:59:00" }, { due_date: "2026-10-28T12:06:00" },
])("通知対象外 %j", (patch) => {
  Object.assign(tasks[0], patch);
  start();
  expect(shown).toHaveLength(0);
});
test("0分は到達直後の1周期だけ通知する", () => {
  notification.minutesBefore = 0;
  vi.setSystemTime(new Date(2026, 9, 28, 12, 4, 45));
  start();
  expect(shown).toHaveLength(0);
  vi.advanceTimersByTime(30000);
  expect(shown).toHaveLength(1);
  expect(shown[0].body).toContain("になりました");
  vi.advanceTimersByTime(30000);
  expect(shown).toHaveLength(1);
  service.stop();
  start();
  expect(shown).toHaveLength(1);
});
test("日付変更後は新しい時刻を通知できる", () => {
  start();
  tasks[0].due_date = "2026-10-28T12:04:00";
  vi.advanceTimersByTime(30000);
  expect(shown).toHaveLength(2);
});
test("時刻境界では期限切れ通知をしない", () => {
  vi.setSystemTime(new Date(2026, 9, 28, 12, 5, 0));
  start();
  expect(shown).toHaveLength(0);
});
