import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Register the actual handlers without starting Electron or opening a database.
const source = readFileSync(new URL("../../src/main/main.js", import.meta.url), "utf8");
describe("AI履歴IPCの読み込み失敗", () => {
  for (const method of ["listMessages", "listReferences"]) {
    it(`${method}: 空の履歴と読込エラーを区別し、内部情報を漏らさない`, async () => {
      const start = source.indexOf(`ipcMain.handle("aiChat:${method}"`);
      const end = source.indexOf("\n});", start) + "\n});".length;
      let handler;
      const read = vi.fn(() => []);
      const logger = { error: vi.fn() };
      vm.runInNewContext(source.slice(start, end), {
        ipcMain: { handle: (_channel, callback) => { handler = callback; } },
        servicesReady: Promise.resolve(), aiService: { [method]: read }, logger,
      });
      await expect(handler(null, "thread-a")).resolves.toEqual([]);
      read.mockImplementation(() => { throw new Error("private database path"); });
      await expect(handler(null, "thread-a")).rejects.toThrow("読み込めませんでした");
      await expect(handler(null, "thread-a")).rejects.not.toThrow("private database path");
      expect(logger.error).toHaveBeenCalled();
    });
  }
});
