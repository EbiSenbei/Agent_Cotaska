import { describe, expect, it } from "vitest";
import { markdown, renderMarkdownEditorHtml } from "./markdownEditor";

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

describe("task list markdown preview", () => {
  const countCheckboxes = (html) => (html.match(/cotaska-task-list-checkbox/g) || []).length;

  it("renders supported task list markers in lists, nesting, and blockquotes", () => {
    const html = markdown.render([
      "- [ ] bullet",
      "  - [x] nested",
      "* [X] asterisk",
      "+ [ ] plus",
      "1. [x] ordered-dot",
      "1) [ ] ordered-parenthesis",
      "> - [X] quoted",
    ].join("\n"));

    expect(countCheckboxes(html)).toBe(7);
    expect(html).toContain('class="cotaska-task-list-item"');
    expect(html).toContain('aria-label="未完了"');
    expect(html).toContain('aria-label="完了" checked');
    expect(html).not.toContain("[ ] bullet");
    expect(html).not.toContain("[x] nested");
  });

  it("keeps markdown formatting after the task marker", () => {
    const html = markdown.render("- [ ] **strong** [link](https://example.com) `code`");

    expect(countCheckboxes(html)).toBe(1);
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("<del>");
  });

  it("treats a leading task marker as a task even when a link reference has the same label", () => {
    const html = markdown.render("- [x] completed\n\n[x]: https://example.com");

    expect(countCheckboxes(html)).toBe(1);
    expect(html).toContain('aria-label="完了" checked');
    expect(html).not.toContain('<a href="https://example.com">x</a>');
  });

  it("only converts a marker in the first paragraph of a list item", () => {
    const html = markdown.render("- ordinary paragraph\n\n  [ ] later paragraph");

    expect(countCheckboxes(html)).toBe(0);
  });

  it.each([
    "[]",
    "[ ] outside",
    "- [ ]missing-space",
    "- [  ] double-space",
    "- [v] unsupported",
    "- \\[ ] escaped",
    "- [ ]",
    "`- [ ] inline-code`",
    "```markdown\n- [ ] fenced-code\n```",
    "    - [ ] indented-code",
  ])("does not convert non-target source: %s", (source) => {
    const html = markdown.render(source);
    expect(countCheckboxes(html)).toBe(0);
  });
});
