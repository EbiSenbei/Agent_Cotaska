import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const service = require("./aiService");
const { buildReferenceContext } = require("./aiChatReferences");

describe("予約投稿の参照分離", () => {
  it("空のID指定は既存添付を再送せず、ID指定したファイルだけを送る", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-refs-"));
    const original = service.listReferences;
    try {
      fs.writeFileSync(path.join(directory, "first.md"), "最初の添付");
      fs.writeFileSync(path.join(directory, "second.md"), "次の添付");
      service.listReferences = () => [
        { reference_id: "1", ref_type: "file", file_path: "first.md" },
        { reference_id: "2", ref_type: "file", file_path: "second.md" },
      ];
      expect(buildReferenceContext("t", directory, {}, { referenceIds: [] }).promptPrefix).toBe("");
      const result = buildReferenceContext("t", directory, {}, { referenceIds: ["2"] });
      expect(result.promptPrefix).toContain("次の添付");
      expect(result.promptPrefix).not.toContain("最初の添付");
      expect(buildReferenceContext("t", directory, {}).usedCount).toBe(2);
      for (const mode of ["manual", "skip-in-speed"]) {
        for (const override of ["skip", "manual", "skip-in-speed"]) {
          expect(buildReferenceContext("t", directory, { referenceSendMode: mode }, {
            referenceSendMode: override, isSpeedMode: true, referenceIds: ["2"],
          }).promptPrefix).toContain("次の添付");
        }
      }
      expect(() => buildReferenceContext("t", directory, { maxReferenceFiles: 1 })).toThrow("件数上限");
      expect(() => buildReferenceContext("t", directory, { maxReferenceChars: 1 })).toThrow("文字数上限");
      service.listReferences = () => [{ reference_id: "missing", ref_type: "file", file_path: "missing.txt" }];
      expect(() => buildReferenceContext("t", directory, {})).toThrow("見つかりません");
    } finally {
      service.listReferences = original;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
