import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../src/main/aiService.js', import.meta.url));

test('完了runと応答を1回で永続化し、失敗はrollback・同値更新はskipする', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-ai-tx-'));
  const module = { exports: {} };
  let writes = 0;
  const custom = (id) => {
    if (id === 'fs') return { ...fs, writeFileSync(...args) { writes++; return fs.writeFileSync(...args); } };
    if (id === './settingsService') return { migrateLegacyResourceData() {}, getSettings: () => ({ settings: {} }) };
    if (id === './projectContext') return { getCurrent: () => ({ aiDatabaseFile: path.join(root, 'ai.sqlite') }) };
    return require(id);
  };
  custom.resolve = require.resolve;
  vm.runInNewContext(fs.readFileSync(new URL('../../src/main/aiService.js', import.meta.url), 'utf8'), { module, require: custom, Buffer, console });
  const service = module.exports;
  try {
    await service.openAiService(); const thread = service.createThread({ title: 'one' });
    const run = service.createRun({ thread_id: thread.thread_id }); writes = 0;
    service.withTransaction(() => {
      service.updateRun(run.run_id, { run_status: 'completed' });
      service.addMessage({ thread_id: thread.thread_id, role: 'assistant', content: 'saved' });
    });
    expect(writes).toBe(1);
    service.updateRun(run.run_id, { run_status: 'completed' }); expect(writes).toBe(1);
    expect(() => service.withTransaction(() => { service.addMessage({ thread_id: thread.thread_id, content: 'rollback' }); throw new Error('failed'); })).toThrow('failed');
    expect(service.listMessages(thread.thread_id)).toHaveLength(1); expect(writes).toBe(1);
    service.markThreadRead(thread.thread_id); const count = writes;
    service.markThreadRead(thread.thread_id); expect(writes).toBe(count);
    service.closeAiService(); await service.openAiService();
    expect(service.listMessages(thread.thread_id)[0].content).toBe('saved');
    expect(service.listRuns(thread.thread_id)[0].run_status).toBe('completed');
  } finally { service.closeAiService(); fs.rmSync(root, { recursive: true, force: true }); }
});
