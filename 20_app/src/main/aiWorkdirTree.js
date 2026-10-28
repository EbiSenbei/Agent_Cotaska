const fs = require("fs");
const path = require("path");
const { setImmediate: yieldToEventLoop } = require("timers/promises");

const EXCLUDED_NAMES = new Set([
  ".git", "node_modules", "dist", "release", "temp", ".vite", ".cache",
]);

// Keep the complete, sorted tree, but never wait for disk I/O on the main thread.
async function listWorkdirTree(rootDir, { maxDepth = Infinity } = {}) {
  const root = path.resolve(rootDir);
  const rows = [];
  async function walk(dir, level) {
    if (level > maxDepth) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries = entries.filter(entry => !EXCLUDED_NAMES.has(entry.name));
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath);
      rows.push({
        id: relativePath || entry.name,
        label: entry.name,
        file_path: relativePath,
        type: entry.isDirectory() ? "directory" : "file",
        level,
      });
      // Wide directories also yield while constructing their rows.
      if (rows.length % 256 === 0) await yieldToEventLoop();
      if (entry.isDirectory()) await walk(absolutePath, level + 1);
    }
  }
  await walk(root, 0);
  return { root, rows, truncated: false };
}

module.exports = { listWorkdirTree };
