import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../src/main/codexSdkService.js', import.meta.url));
const settings = { codex: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, workdir: 'C:/test' };
const module = { exports: {} };
const customRequire = (id) => {
  if (id === './settingsService') return { getSettings: () => ({ settings: { aiChat: settings } }) };
  if (id === './aiService' || id === './appLogger') return {};
  return require(id);
};
customRequire.resolve = require.resolve;
const source = fs.readFileSync(new URL('../../src/main/codexSdkService.js', import.meta.url), 'utf8');
vm.runInNewContext(source + '\nmodule.exports.policy = { buildThreadOptions, resolveCodexModel };',
  { module, require: customRequire, process, console });
const { buildThreadOptions, resolveCodexModel } = module.exports.policy;

test('自動モデルだけをGPT-6.2 Solに解決し、明示した旧モデルを保持する', () => {
  expect(resolveCodexModel('')).toBe('gpt-6.2-sol');
  expect(buildThreadOptions({}, { model: '' }).model).toBe('gpt-6.2-sol');
  expect(buildThreadOptions({}, {}).model).toBe('gpt-6.1-sol');
});

test.each(['gpt-6.2-sol', 'gpt-6.2-astra'])('%sのモデル・推論設定をSDKスレッドオプションへ渡す', (model) => {
  const executionSettings = { model, reasoningEffort: 'high', performanceMode: 'standard' };
  expect(buildThreadOptions({}, { model, executionSettings })).toMatchObject({
    model, modelReasoningEffort: 'high', approvalPolicy: 'never', skipGitRepoCheck: true,
  });
});
