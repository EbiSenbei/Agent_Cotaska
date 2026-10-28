import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { listWorkdirTree } = require("../../src/main/aiWorkdirTree");

describe("AI作業フォルダの非同期走査", () => {
  it("IPCは非同期走査の完了を待ってから一覧を返す", async () => {
    const source = fs.readFileSync(new URL("../../src/main/main.js", import.meta.url), "utf8");
    const start = source.indexOf('ipcMain.handle("aiChat:listWorkdirTree"');
    const end = source.indexOf("\n});", start) + "\n});".length;
    let handler, release;
    const scan = vi.fn(() => new Promise(resolve => { release = resolve; }));
    vm.runInNewContext(source.slice(start, end), {
      ipcMain: { handle: (_channel, callback) => { handler = callback; } },
      servicesReady: Promise.resolve(),
      settingsService: { getSettings: () => ({ configured: { aiChatWorkdir: true } }) },
      getAiWorkdir: () => "C:/synthetic", listWorkdirTree: scan, logger: { error: vi.fn() },
    });
    let complete = false;
    const pending = handler().then(result => { complete = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    expect(complete).toBe(false);
    expect(scan).toHaveBeenCalledWith("C:/synthetic");
    release({ rows: [{ id: "file" }], root: "C:/synthetic", truncated: false });
    await expect(pending).resolves.toEqual({ ok: true, workdirConfigured: true,
      rows: [{ id: "file" }], root: "C:/synthetic", truncated: false });
  });

  it("除外、階層順、深さ指定と再取得時の鮮度を維持する", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-workdir-"));
    try {
      fs.mkdirSync(path.join(root, "folder"));
      fs.mkdirSync(path.join(root, "node_modules"));
      fs.writeFileSync(path.join(root, "node_modules", "hidden.txt"), "");
      fs.writeFileSync(path.join(root, "folder", "child.txt"), "");
      fs.writeFileSync(path.join(root, "z.txt"), "");
      const result = await listWorkdirTree(root);
      expect(result.rows.map(row => [row.file_path, row.level, row.type])).toEqual([
        ["folder", 0, "directory"], [path.join("folder", "child.txt"), 1, "file"], ["z.txt", 0, "file"],
      ]);
      expect(result.truncated).toBe(false);
      expect((await listWorkdirTree(root, { maxDepth: 0 })).rows.map(row => row.label))
        .toEqual(["folder", "z.txt"]);
      fs.writeFileSync(path.join(root, "new.txt"), "");
      expect((await listWorkdirTree(root)).rows.some(row => row.label === "new.txt")).toBe(true);
    } finally {
      // root is exclusively the temporary directory returned by mkdtemp above.
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("大きなディレクトリでも走査完了前にイベントループへ制御を返す", async () => {
    const entries = Array.from({ length: 10000 }, (_, i) => ({
      name: `file-${i}.txt`, isDirectory: () => false,
    }));
    const read = vi.spyOn(fs.promises, "readdir").mockResolvedValue(entries);
    const syncRead = vi.spyOn(fs, "readdirSync").mockImplementation(() => { throw new Error("blocking I/O"); });
    let complete = false;
    try {
      const pending = listWorkdirTree(os.tmpdir()).then(result => { complete = true; return result; });
      await new Promise(resolve => setImmediate(resolve));
      expect(complete).toBe(false);
      expect((await pending).rows).toHaveLength(entries.length);
      expect(syncRead).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      syncRead.mockRestore();
    }
  });

  it("読めない子ディレクトリがあっても他の行を返す", async () => {
    const read = vi.spyOn(fs.promises, "readdir")
      .mockResolvedValueOnce([
        { name: "private", isDirectory: () => true },
        { name: "ok.txt", isDirectory: () => false },
      ])
      .mockRejectedValueOnce(new Error("EACCES"));
    try {
      expect((await listWorkdirTree(os.tmpdir())).rows.map(row => row.label)).toEqual(["private", "ok.txt"]);
    } finally { read.mockRestore(); }
  });
});
