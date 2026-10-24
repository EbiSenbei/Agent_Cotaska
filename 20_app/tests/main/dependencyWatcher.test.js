const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const context = require("../../src/main/projectContext");
const tasks = require("../../src/main/taskService");
const watcher = require("../../src/main/watcher");

test("external YAML edits reach the cache, index and renderer after dependency updates", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-dependency-watch-"));
  const messages = [];
  try {
    context.setCurrent(root, { projectId: "watch-test", schemaVersion: 1, name: "test" });
    fs.writeFileSync(path.join(root, "settings.yaml"), "{}");
    await tasks.openTaskService();
    const task = tasks.addTask({ title: "before", due_date: "2026-10-24" });
    await watcher.startWatcher({ isDestroyed: () => false, webContents: { send: (...args) => messages.push(args) } });
    // Wait for chokidar to discover the existing nested task directory.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const file = tasks.getTaskFilePath(task.id);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("title: before", "title: after"));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !messages.some(([channel, data]) => channel === "tasks:changed" && data.tasks.some((item) => item.title === "after"))) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(tasks.getTaskById(task.id)).toMatchObject({ title: "after", due_date: "2026-10-24" });
    expect(messages.some(([channel, data]) => channel === "tasks:changed" && data.tasks.some((item) => item.title === "after"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "tasks/_index.yaml"), "utf8")).toContain("title: after");
  } finally {
    await watcher.stopWatcher();
    context.clear();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 10000);
