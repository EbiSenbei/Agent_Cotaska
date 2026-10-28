const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createProjectOperationGuard } = require('../../src/main/projectOperationGuard');
const source = fs.readFileSync(path.join(__dirname, '../../src/main/main.js'), 'utf8');

test.each(['codex', 'claude'])('%sの実IPCがprovider開始前から終了まで切替を拒否する', async (provider) => {
  let handler, finishSend, finishInit;
  const saved = [];
  const c = {
    projectOperations: createProjectOperationGuard(),
    ipcMain: { handle: (_name, callback) => { handler = callback; } },
    servicesReady: Promise.resolve(), pendingAiSends: new Map(),
    aiProviderRegistry: { resolveProvider: () => ({ sendMessage: () => new Promise(resolve => { finishSend = () => { saved.push(c.project); resolve({ ok: false }); }; }) }) },
    aiService: { getThread: () => ({ thread_status: 'active' }), closeAiService: vi.fn() },
    project: 'A', watcher: { stopWatcher: async () => {} }, reminderService: { stop() {} },
    flushProjectDrafts: async () => {}, detailWindows: new Map(), mainWindow: null,
    projectService: { openProject: value => { c.project = value; return { projectId: value }; } },
    initializeServicesAfterWindowReady: () => new Promise(resolve => { finishInit = resolve; }),
    logger: { error() {} },
  };
  vm.createContext(c);
  const start = source.indexOf('ipcMain.handle("aiChat:sendMessage"');
  const end = source.indexOf('\n});', start) + '\n});'.length;
  vm.runInContext(source.slice(start, end), c);
  const activateStart = source.indexOf('async function activateProject(');
  const activateEnd = source.indexOf('\nipcMain.handle("projects:getCurrent"', activateStart);
  vm.runInContext(source.slice(activateStart, activateEnd), c);
  const send = handler(null, { thread_id: 'thread-a', executionSettings: { provider } });
  // The claim is acquired synchronously, before even servicesReady resolves.
  await expect(c.activateProject('B')).rejects.toThrow('AI');
  await Promise.resolve(); finishSend(); await send;
  expect(saved).toEqual(['A']);
  const switching = c.activateProject('B');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const rejected = await handler(null, { thread_id: 'new', executionSettings: { provider } });
  expect(rejected.ok).toBe(false); expect(rejected.error).toContain('切り替え');
  finishInit(); await switching; expect(c.project).toBe('B');
});
