// Keep each edit as a patch; a delayed text edit must never resend old metadata.
const savers = new Set();
const draftsByKey = new Map();

export function createTaskDraftSaver({ key, write, onSaved = () => {}, onError = () => {}, delay = 500 }) {
  if (key && draftsByKey.has(key)) {
    const existing = draftsByKey.get(key);
    existing.rebind({ write, onSaved, onError });
    return existing;
  }
  let pending = {};
  let dirty = {};
  let values = {};
  let disposed = false;
  let revision = 0;
  let timer;
  let queue = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!Object.keys(pending).length) return queue;
    const patch = pending;
    const versions = { ...dirty };
    pending = {};
    queue = queue.catch(() => {}).then(async () => {
      try {
        const result = await write(patch);
        if (result?.ok === false || result?.success === false) throw new Error(result.error || '保存できませんでした。');
        for (const field of Object.keys(patch)) if (dirty[field] === versions[field]) { delete dirty[field]; delete values[field]; }
        if (disposed && !Object.keys(dirty).length) { savers.delete(saver); if (key) draftsByKey.delete(key); }
        onSaved();
      } catch (error) {
        // Retain failed edits for explicit retry without replacing a newer edit.
        const failed = Object.fromEntries(Object.entries(patch).filter(([field]) => dirty[field] === versions[field]));
        pending = { ...failed, ...pending };
        onError(error);
        throw error;
      }
    });
    return queue;
  };
  const saver = {
    stage(patch) {
      savers.add(saver);
      if (key) draftsByKey.set(key, saver);
      pending = { ...pending, ...patch };
      values = { ...values, ...patch };
      for (const field of Object.keys(patch)) dirty[field] = ++revision;
      clearTimeout(timer);
      timer = setTimeout(() => { flush().catch(() => {}); }, delay);
    },
    save(patch) { saver.stage(patch); return flush(); },
    isDirty(field) { return Object.hasOwn(dirty, field); },
    value(field, fallback) { return Object.hasOwn(dirty, field) ? values[field] : fallback; },
    hasEdits() { return Object.keys(dirty).length > 0; },
    rebind(options) { write = options.write; onSaved = options.onSaved; onError = options.onError; disposed = false; },
    flush,
    dispose() {
      disposed = true;
      if (!Object.keys(dirty).length) { savers.delete(saver); if (key) draftsByKey.delete(key); }
      return flush();
    },
  };
  return saver;
}

export async function flushTaskDrafts() {
  await Promise.all([...savers].map(saver => saver.flush()));
}

export function hasTaskDrafts() {
  return [...savers].some(saver => saver.hasEdits());
}
