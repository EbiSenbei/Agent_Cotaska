const { EventEmitter } = require('events');
const { createCodexLogin } = require('../../src/main/codexLogin');
function setup(options = {}) {
  const child = new EventEmitter();
  child.kill = vi.fn(() => { child.emit('close', null); return true; });
  const deps = { spawn: vi.fn(() => child), resolveBinary: () => ({ command: 'bundled/codex.exe', argsPrefix: [] }), buildEnv: () => ({ CODEX_HOME: 'same-as-chat' }), checkAuthStatus: vi.fn(async () => ({ ok: true, status: 'available' })), ...options };
  return { child, deps, login: createCodexLogin(deps) };
}
afterEach(() => vi.useRealTimers());
test('duplicate starts use one bundled CLI and do not capture credentials', async () => {
  const { login, child, deps } = setup();
  login.start(); login.start();
  expect(deps.spawn).toHaveBeenCalledTimes(1);
  expect(deps.spawn).toHaveBeenCalledWith('bundled/codex.exe', ['login'], expect.objectContaining({ env: { CODEX_HOME: 'same-as-chat' }, windowsHide: true, shell: false, stdio: 'ignore' }));
  child.emit('close', 0);
  await Promise.resolve();
  expect(deps.checkAuthStatus).toHaveBeenCalledTimes(1);
  expect(login.getStatus()).toMatchObject({ status: 'completed', active: false });
});
test('cancellation waits for process close, preserves auth and permits retry', () => {
  const { login, child, deps } = setup();
  child.kill.mockImplementation(() => true);
  login.start(); login.cancel(); login.start();
  expect(deps.spawn).toHaveBeenCalledTimes(1);
  expect(login.getStatus()).toMatchObject({ status: 'stopping', active: true });
  child.emit('close', 0);
  expect(login.getStatus()).toMatchObject({ status: 'cancelled', active: false });
  expect(deps.checkAuthStatus).not.toHaveBeenCalled();
  login.start(); expect(deps.spawn).toHaveBeenCalledTimes(2); login.cancel(); child.emit('close', null);
});
test('timeout closes only the login child and permits retry', () => {
  vi.useFakeTimers();
  const { login, child } = setup({ timeoutMs: 50 });
  login.start(); vi.advanceTimersByTime(50);
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(login.getStatus()).toMatchObject({ status: 'timeout', active: false });
  login.start(); login.cancel();
});
test('spawn errors and nonzero exits never expose raw error details', () => {
  const { login, child } = setup();
  login.start(); child.emit('error', new Error('SECRET_TOKEN'));
  child.emit('close', 1);
  expect(login.getStatus()).toMatchObject({ status: 'failed', active: false });
  expect(JSON.stringify(login.getStatus())).not.toContain('SECRET_TOKEN');
  login.start(); child.emit('close', 1);
  expect(login.getStatus().status).toBe('failed');
});
test('auth check retains lock and a failed check does not claim success', async () => {
  let done;
  const { login, child, deps } = setup({ checkAuthStatus: () => new Promise(resolve => { done = resolve; }) });
  login.start(); child.emit('close', 0); login.cancel(); login.start();
  expect(login.getStatus()).toMatchObject({ status: 'checking', active: true });
  expect(deps.spawn).toHaveBeenCalledTimes(1);
  done({ ok: false, status: 'login_required' }); await Promise.resolve();
  expect(login.getStatus()).toMatchObject({ status: 'failed', active: false });
});
test('missing executable and rejected auth check release the lock', async () => {
  const missing = setup({ resolveBinary: () => { throw new Error('private path'); } });
  expect(missing.login.start()).toMatchObject({ status: 'failed', active: false });
  const { login, child } = setup({ checkAuthStatus: async () => { throw new Error('SECRET'); } });
  login.start(); child.emit('close', 0); await Promise.resolve();
  expect(login.getStatus()).toMatchObject({ status: 'failed', active: false });
  expect(JSON.stringify(login.getStatus())).not.toContain('SECRET');
});
