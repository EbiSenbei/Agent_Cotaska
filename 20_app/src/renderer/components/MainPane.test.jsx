import { describe, expect, it } from "vitest";
import { extractQuickAddDate, extractQuickAddPriority, extractQuickAddTags } from "./MainPane";

describe("クイック追加の入力補正", () => {
  it("タグと優先度の記法をタスク名から除去する", () => {
    const priority = extractQuickAddPriority("明日 企画書レビュー #仕事 !高");
    const tags = extractQuickAddTags(priority.title);

    expect(priority).toEqual({ title: "明日 企画書レビュー #仕事", priority: "high" });
    expect(tags).toEqual({ title: "明日 企画書レビュー", tags: ["仕事"] });
  });

  it("日付記法を期限とタイトルへ分離する", () => {
    const result = extractQuickAddDate("明日 企画書レビュー");

    expect(result.title).toBe("企画書レビュー");
    expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
