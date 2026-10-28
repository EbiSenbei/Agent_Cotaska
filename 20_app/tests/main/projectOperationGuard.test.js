const { createProjectOperationGuard } = require('../../src/main/projectOperationGuard');

test('両providerの開始準備・並行実行・finallyが終わるまで切替を拒否する', async () => {
  const guard = createProjectOperationGuard();
  const finishCodex = guard.beginRun();
  const finishClaude = guard.beginRun();
  expect(() => guard.beginTransition()).toThrow('AI');
  finishCodex(); finishCodex();
  expect(() => guard.beginTransition()).toThrow('AI');
  finishClaude();
  const finishTransition = guard.beginTransition();
  expect(() => guard.beginRun()).toThrow('切り替え');
  expect(() => guard.beginTransition()).toThrow('進行中');
  finishTransition();
  const finish = guard.beginRun(); finish();
  guard.beginTransition()();
});
