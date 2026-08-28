import { describe, expect, it } from "vitest";
import { renderMarkdownEditorHtml } from "./markdownEditor";

describe("renderMarkdownEditorHtml", () => {
  it("keeps source newlines without per-line block wrappers", () => {
    const html = renderMarkdownEditorHtml("first\n\nthird");

    expect(html).toBe("first\n&nbsp;\nthird");
    expect(html).not.toContain("markdown-editor-line");
    expect(html).not.toContain("<div");
  });

  it("adds syntax spans without changing the source characters", () => {
    const source = "## heading **strong** `code`";
    const html = renderMarkdownEditorHtml(source);
    const plainText = html
      .replace(/<[^>]+>/g, "")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'");

    expect(plainText).toBe(source);
  });
});
