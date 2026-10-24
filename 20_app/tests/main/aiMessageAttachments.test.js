import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// VM内の相対requireは読み込む本番ソースを基準に解決する。
const sourceRequire = createRequire(new URL("../../src/main/aiService.js", import.meta.url));

describe("添付履歴の永続化", () => {
  it("既存DBを移行し、投稿の添付だけ解除して再読込後も履歴を保持する", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-attachments-"));
    const dbFile = path.join(dir, "ai.sqlite");
    const SQL = await require("sql.js")();
    const oldDb = new SQL.Database();
    oldDb.run("CREATE TABLE ai_messages (message_id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT, codex_run_id TEXT, token_count INTEGER, error_code TEXT, error_message TEXT, created_at TEXT)");
    oldDb.run("INSERT INTO ai_messages VALUES ('old', 'old-thread', 'user', 'old content', NULL, NULL, NULL, NULL, '2026-01-01')");
    fs.writeFileSync(dbFile, Buffer.from(oldDb.export()));
    oldDb.close();
    const module = { exports: {} };
    const customRequire = (id) => {
      if (id === "./settingsService") return { migrateLegacyResourceData() {} };
      if (id === "./projectContext") return { getCurrent: () => ({ aiDatabaseFile: dbFile }) };
      if (id === "./earlyStartupLogger") return { logError() {} };
      return sourceRequire(id);
    };
    customRequire.resolve = sourceRequire.resolve;
    vm.runInNewContext(fs.readFileSync(new URL("../../src/main/aiService.js", import.meta.url), "utf8"),
      { require: customRequire, module, Buffer, console });
    const service = module.exports;
    try {
      await service.openAiService();
      expect(service.listMessages("old-thread")[0].attachments).toEqual([]);
      const thread = service.createThread({ title: "test" });
      const first = service.addReference({ thread_id: thread.thread_id, file_path: "仕様.md" });
      const second = service.addReference({ thread_id: thread.thread_id, file_path: "次回.md" });
      expect(() => service.addMessage({ thread_id: "missing", consume_reference_ids: [first.reference_id] })).toThrow();
      expect(service.listReferences(thread.thread_id)).toHaveLength(2);
      const attachments = [{ id: first.reference_id, label: "仕様.md", filePath: first.file_path }];
      service.addMessage({ thread_id: thread.thread_id, content: "確認", attachments,
        consume_reference_ids: [first.reference_id] });
      expect(service.listReferences(thread.thread_id).map(ref => ref.reference_id)).toEqual([second.reference_id]);
      service.closeAiService();
      await service.openAiService();
      expect(service.listMessages(thread.thread_id)[0].attachments).toEqual(attachments);
      expect(service.listMessages(thread.thread_id)[0].content).toBe("確認");
    } finally {
      service.closeAiService();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
