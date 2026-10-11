import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiChatContextPanel from "./AiChatContextPanel";

function renderFile(file) {
  return renderToStaticMarkup(<AiChatContextPanel
    contextPanel={{ type: "file", status: "ready", file }}
    isMarkdownFile={(value) => value?.extension === ".md"}
    filePreviewMode={false}
  />);
}

describe("ファイルビュー", () => {
  it("画像をimgで表示し、テキスト欄やMarkdown切替を出さない", () => {
    const html = renderFile({ path: "test.svg", label: "test.svg", preview_type: "image", url: "data:image/svg+xml;base64,PHN2Zy8+" });
    expect(html).toContain('<img');
    expect(html).toContain('alt="test.svg"');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('プレビュー表示へ切替');
    expect(html).toContain('外部アプリで開く');
  });
  it("テキストとPDFは従来の表示を維持する", () => {
    expect(renderFile({ preview_type: "text", content: "hello" })).toContain('hello</textarea>');
    expect(renderFile({ preview_type: "pdf", url: "file:///test.pdf" })).toContain('<iframe');
  });
});
