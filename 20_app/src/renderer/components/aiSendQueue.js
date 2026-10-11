// A synchronous lock prevents repeated Enter presses from starting parallel IPC requests.
export class AiSendQueue {
  items = [];
  busy = false;
  paused = new Set();

  add(item) { this.items.push(item); }
  remove(id) { this.items = this.items.filter((item) => item.id !== id); }
  take(threadId) {
    if (this.busy || this.paused.has(threadId)) return null;
    const index = this.items.findIndex((item) => item.threadId === threadId);
    if (index < 0) return null;
    return this.items.splice(index, 1)[0];
  }
}
