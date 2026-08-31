import { describe, expect, it } from "vitest";
import { CODEX_MODEL_OPTIONS, withExistingModelOption } from "./aiModelOptions";

describe("withExistingModelOption", () => {
  it("既知モデルまたは自動設定では選択肢を増やさない", () => {
    expect(withExistingModelOption(CODEX_MODEL_OPTIONS, "")).toBe(CODEX_MODEL_OPTIONS);
    expect(withExistingModelOption(CODEX_MODEL_OPTIONS, "gpt-5.6-terra")).toBe(CODEX_MODEL_OPTIONS);
  });

  it("選択肢外の既存モデルIDを失わず追加する", () => {
    expect(withExistingModelOption(CODEX_MODEL_OPTIONS, "custom-model")).toEqual([
      ...CODEX_MODEL_OPTIONS,
      { value: "custom-model", label: "custom-model（既存設定）" },
    ]);
  });
});
