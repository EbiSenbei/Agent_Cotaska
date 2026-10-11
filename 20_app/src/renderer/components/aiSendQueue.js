// Claim the thread synchronously, before any async preparation or IPC.
export class AiSendQueue {
  items = [];
  running = new Map();
  paused = new Set();

  add(item) { this.items.push(item); }
  remove(id) { this.items = this.items.filter((item) => item.id !== id); }
  isBusy(threadId) { return this.running.has(threadId); }
  take(threadId) {
    if (this.isBusy(threadId) || this.paused.has(threadId)) return null;
    const index = this.items.findIndex((item) => (item.key ?? item.threadId) === threadId);
    if (index < 0) return null;
    const item = this.items.splice(index, 1)[0];
    this.running.set(threadId, item);
    return item;
  }
  bindThread(item, threadId) {
    const oldKey = item.key ?? item.threadId;
    if (this.running.get(oldKey) !== item) throw new Error("送信予約のロックが見つかりません。");
    if (oldKey !== threadId && this.isBusy(threadId)) throw new Error("このスレッドは送信中です。");
    this.running.delete(oldKey);
    this.running.set(threadId, item);
    for (const queued of this.items) {
      if ((queued.key ?? queued.threadId) === oldKey) {
        queued.key = threadId;
        queued.threadId = threadId;
      }
    }
    if (this.paused.delete(oldKey)) this.paused.add(threadId);
    item.key = threadId;
    item.threadId = threadId;
  }
  finish(item, { accepted = false, failed = false } = {}) {
    const key = item.key ?? item.threadId;
    if (this.running.get(key) !== item) return;
    if (failed || !accepted) this.paused.add(key);
    if (!accepted) this.items.unshift(item);
    this.running.delete(key);
  }
}
