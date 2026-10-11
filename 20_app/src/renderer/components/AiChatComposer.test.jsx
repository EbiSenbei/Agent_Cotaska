import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiChatComposer from "./AiChatComposer";

describe("処理中の入力", () => {
  it("入力を許可し、送信予約と中断を同時に表示する", () => {
    const previous = globalThis.window;
    globalThis.window = { innerHeight: 900 };
    try {
      const html = renderToStaticMarkup(<AiChatComposer draft="次の指示" onDraftChange={() => {}} isSending references={[]}
        modelOptions={[]} sandboxOptions={[]} referenceSendOptions={[]} />);
      expect(html.match(/<textarea[^>]*>/)[0]).not.toContain("disabled");
      expect(html).toContain('aria-label="送信待ちに追加"');
      expect(html).toContain('aria-label="AI処理を中断"');
      const handle = html.match(/<div[^>]*role="separator"[^>]*>/)[0];
      expect(handle).toContain('tabindex="0"');
      expect(handle).not.toContain('aria-disabled="true"');
    } finally { globalThis.window = previous; }
  });
});
