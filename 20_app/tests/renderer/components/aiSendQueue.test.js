import { describe, expect, it } from "vitest";
import { AiSendQueue } from "../../../src/renderer/components/aiSendQueue";

describe("送信予約", () => {
  it("FIFOで取り出し、非選択スレッドの投稿を混ぜない", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a", text: "最初" });
    queue.add({ id: "2", threadId: "b", text: "別スレッド" });
    queue.add({ id: "3", threadId: "a", text: "次" });
    const first = queue.take("a");
    expect(first.id).toBe("1");
    queue.finish(first, { accepted: true });
    expect(queue.take("a").id).toBe("3");
    expect(queue.take("a")).toBeNull();
    expect(queue.take("b").id).toBe("2");
  });
  it("送信準備中・実行中・失敗後には待ちを保持し、再開後だけ取り出す", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a" });
    const first = queue.take("a");
    expect(queue.take("a")).toBeNull();
    queue.finish(first, { failed: true });
    expect(queue.take("a")).toBeNull();
    queue.paused.delete("a");
    expect(queue.take("a").id).toBe("1");
  });
  it("A実行中もBを開始し、B完了でAの次投稿を開始しない", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "a1", threadId: "a" });
    queue.add({ id: "a2", threadId: "a" });
    queue.add({ id: "b1", threadId: "b" });
    const a = queue.take("a");
    const b = queue.take("b");
    expect(b.id).toBe("b1");
    expect(queue.take("a")).toBeNull();
    queue.finish(b, { accepted: true });
    expect(queue.take("a")).toBeNull();
    queue.finish(a, { accepted: true });
    expect(queue.take("a").id).toBe("a2");
  });
  it("Aの受付後失敗・中断はBを止めず、受付済み投稿を再送しない", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "a1", threadId: "a" });
    queue.add({ id: "a2", threadId: "a" });
    queue.add({ id: "b1", threadId: "b" });
    queue.finish(queue.take("a"), { accepted: true, failed: true });
    expect(queue.take("a")).toBeNull();
    expect(queue.take("b").id).toBe("b1");
    expect(queue.items.map((item) => item.id)).toEqual(["a2"]);
    queue.paused.delete("a");
    expect(queue.take("a").id).toBe("a2");
  });
  it("異なる新規スレッドを並列作成し、それぞれの後続予約だけを移す", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "new1", threadId: null, key: "draft1" });
    queue.add({ id: "follow1", threadId: null, key: "draft1" });
    queue.add({ id: "new2", threadId: null, key: "draft2" });
    const first = queue.take("draft1");
    const second = queue.take("draft2");
    queue.bindThread(first, "a");
    queue.bindThread(second, "b");
    expect(queue.items[0].threadId).toBe("a");
    expect(queue.take("a")).toBeNull();
    queue.finish(second, { accepted: true });
    expect(queue.take("a")).toBeNull();
    queue.finish(first, { accepted: true });
    expect(queue.take("a").id).toBe("follow1");
  });
  it("終了通知の重複で後続投稿のロックを解除しない", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a" });
    queue.add({ id: "2", threadId: "a" });
    const first = queue.take("a");
    queue.finish(first, { accepted: true });
    queue.take("a");
    queue.finish(first, { accepted: true });
    expect(queue.isBusy("a")).toBe(true);
  });
  it("取消は指定した投稿だけを除外する", () => {
    const queue = new AiSendQueue();
    queue.add({ id: "1", threadId: "a" });
    queue.add({ id: "2", threadId: "a" });
    queue.remove("1");
    expect(queue.take("a").id).toBe("2");
  });
});
