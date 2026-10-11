import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiChatMessage from "./AiChatMessage";

describe("メッセージの添付履歴", () => {
  it("本文と添付名を表示し、ファイル名をHTMLとして解釈しない", () => {
    const html = renderToStaticMarkup(<AiChatMessage message={{
      role: "user", body: "確認してください", author: "ユーザー",
      attachments: [{ id: "ref1", label: "<script>.md", filePath: "C:/仕様/<script>.md" }],
    }} />);
    expect(html).toContain("確認してください");
    expect(html).toContain('aria-label="添付ファイル"');
    expect(html).toContain("&lt;script&gt;.md");
    expect(html).not.toContain("<script>");
  });
  it("添付情報のない既存メッセージには添付欄を表示しない", () => {
    expect(renderToStaticMarkup(<AiChatMessage message={{ role: "user", body: "以前の投稿" }} />))
      .not.toContain('aria-label="添付ファイル"');
  });
});
