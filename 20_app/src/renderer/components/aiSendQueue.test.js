import { describe, expect, it } from "vitest";
import { AiSendQueue } from "./aiSendQueue";

describe("送信予約", () => {
  it("FIFOで取り出し、非選択スレッドの投稿を混ぜない", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a", text: "最初" });
    queue.add({ id: "2", threadId: "b", text: "別スレッド" });
    queue.add({ id: "3", threadId: "a", text: "次" });
    expect(queue.take("a").id).toBe("1");
    expect(queue.take("a").id).toBe("3");
    expect(queue.take("a")).toBeNull();
    expect(queue.take("b").id).toBe("2");
  });
  it("送信準備中・実行中・失敗後には待ちを保持し、再開後だけ取り出す", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a" });
    queue.busy = true;
    expect(queue.take("a")).toBeNull();
    queue.busy = false;
    queue.paused.add("a");
    expect(queue.take("a")).toBeNull();
    queue.paused.delete("a");
    expect(queue.take("a").id).toBe("1");
  });
  it("取消は指定した投稿だけを除外する", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a" });
    queue.add({ id: "2", threadId: "a" });
    queue.remove("1");
    expect(queue.take("a").id).toBe("2");
  });
});
