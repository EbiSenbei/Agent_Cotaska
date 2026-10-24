import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
// VM内の相対requireは読み込む本番ソースを基準に解決する。
const sourceRequire = createRequire(new URL("../../src/main/aiService.js", import.meta.url));
const { assertThreadArchivable } = require("../../src/main/aiThreadActions");

describe("スレッドのアーカイブと復元", () => {
  it("両プロバイダーと送信準備を確認し、別スレッドの実行を妨げない", () => {
    const runs = { codex: [], claude: [] };
    const registry = { resolveProvider: (provider) => ({ listActiveRuns: () => runs[provider] }) };
    expect(() => assertThreadArchivable("target", registry)).not.toThrow();
    for (const provider of ["codex", "claude"]) {
      runs[provider] = [{ thread_id: "target" }];
      expect(() => assertThreadArchivable("target", registry)).toThrow("AI処理中");
      expect(() => assertThreadArchivable("other", registry)).not.toThrow();
      runs[provider] = [];
    }
    expect(() => assertThreadArchivable("target", registry, new Map([["target", 1]]))).toThrow("送信準備中");
  });

  it("アーカイブ後に再起動しても本文・参照・添付履歴を保持し、復元できる", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-thread-archive-"));
    const module = { exports: {} };
    const customRequire = (id) => {
      if (id === "./settingsService") return { migrateLegacyResourceData() {} };
      if (id === "./projectContext") return { getCurrent: () => ({ aiDatabaseFile: path.join(directory, "ai.sqlite") }) };
      if (id === "./earlyStartupLogger") return { logError() {} };
      return sourceRequire(id);
    };
    customRequire.resolve = sourceRequire.resolve;
    vm.runInNewContext(fs.readFileSync(new URL("../../src/main/aiService.js", import.meta.url), "utf8"),
      { require: customRequire, module, Buffer, console });
    const service = module.exports;
    try {
      await service.openAiService();
      const thread = service.createThread({ title: "確認用", primary_task_id: "T-0772" });
      const id = thread.thread_id;
      service.addReference({ thread_id: id, file_path: "仕様.md" });
      const attachments = [{ id: "image1", label: "画像.png", filePath: "cotaska-image:chat/test/image.png" }];
      service.addMessage({ thread_id: id, role: "user", content: "残す本文", attachments });
      service.archiveThread(id);
      expect(service.listThreads()).toHaveLength(0);
      expect(service.listThreads({ includeArchived: true })[0].thread_status).toBe("archived");
      service.closeAiService();
      await service.openAiService();
      expect(service.getThread(id).primary_task_id).toBe("T-0772");
      expect(service.listMessages(id)[0].content).toBe("残す本文");
      expect(service.listMessages(id)[0].attachments).toEqual(attachments);
      expect(service.listReferences(id)[0].file_path).toBe("仕様.md");
      service.updateThread(id, { thread_status: "active" });
      expect(service.listThreads()[0].thread_id).toBe(id);
      service.closeAiService();
      await service.openAiService();
      expect(service.listThreads()[0].thread_status).toBe("active");
    } finally {
      service.closeAiService();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
