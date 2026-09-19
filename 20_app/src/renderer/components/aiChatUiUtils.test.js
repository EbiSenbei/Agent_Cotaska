import { describe, expect, it } from "vitest";
import { clampContextPanelWidth, getExplorerTarget, normalizeOption } from "./aiChatUiUtils";

describe("AI chat UI utilities", () => {
  it("clamps the context-panel width to its supported range", () => {
    expect(clampContextPanelWidth(100)).toBe(320);
    expect(clampContextPanelWidth(900)).toBe(720);
    expect(clampContextPanelWidth(410.6)).toBe(411);
  });

  it("uses the fallback for unsupported options", () => {
    const values = new Set(["read-only", "workspace-write"]);
    expect(normalizeOption("workspace-write", values, "read-only")).toBe("workspace-write");
    expect(normalizeOption("unknown", values, "read-only")).toBe("read-only");
  });

  it("returns only local file-system paths as Explorer targets", () => {
    expect(getExplorerTarget({ target_type: "file", file_path: "C:\\work\\note.md" })).toBe("C:\\work\\note.md");
    expect(getExplorerTarget({ target_type: "folder", folder_path: "C:\\work" })).toBe("C:\\work");
    expect(getExplorerTarget({ target_type: "url", url: "https://example.com" })).toBe("");
  });
});
