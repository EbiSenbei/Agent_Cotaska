import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import AiThreadMenu from "../../../src/renderer/components/AiThreadMenu";

describe("スレッド操作メニュー", () => {
  it("未紐づけ・処理中の操作を理由付きで無効にする", () => {
    const html = renderToStaticMarkup(<AiThreadMenu thread={{ status: "active" }} x={0} y={0}
      archiveDisabledReason="AI処理中・送信準備中はアーカイブできません" />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("このスレッドにはタスクが紐づいていません");
    expect(html).toContain("AI処理中・送信準備中はアーカイブできません");
    expect(html).toContain("スレッドの名前を変更");
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("このスレッドをアーカイブ"));
  });

  it("タスク付きのアーカイブ済みスレッドにはフォルダ起動と復元を表示する", () => {
    const html = renderToStaticMarkup(<AiThreadMenu thread={{ status: "archived", primaryTaskId: "T-0772" }} x={0} y={0} />);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("タスクフォルダを開く");
    expect(html).toContain("スレッドを復元");
    expect(html).not.toContain("このスレッドをアーカイブ");
  });
});
