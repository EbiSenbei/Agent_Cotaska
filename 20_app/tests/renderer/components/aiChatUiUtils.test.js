import { describe, expect, it } from "vitest";
import { clampContextPanelWidth, getExplorerTarget, normalizeOption } from "../../../src/renderer/components/aiChatUiUtils";

describe("AI chat UI utilities", () => {
  it("clamps the context-panel width to its supported range", () => {
    expect(clampContextPanelWidth(100)).toBe(480);
    expect(clampContextPanelWidth(900)).toBe(720);
    expect(clampContextPanelWidth(520.6)).toBe(521);
    expect(clampContextPanelWidth(320)).toBe(480);
    expect(clampContextPanelWidth(null)).toBe(520);
    expect(clampContextPanelWidth("")).toBe(520);
    expect(clampContextPanelWidth("invalid")).toBe(520);
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
