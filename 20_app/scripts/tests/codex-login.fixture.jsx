import React from 'react';
import { createRoot } from 'react-dom/client';
import SettingsPane from '../../src/renderer/components/SettingsPane';
import '../../src/renderer/App.css';

let state = { status: 'idle', active: false, message: 'ログインしてください。' };
let starts = 0;
let cancels = 0;
window.cotaskaAPI = {
  settings: { get: async () => ({ settings: { aiChat: { provider: 'codex' } } }) },
  aiChat: {
    getCodexLoginStatus: async () => state,
    startCodexLogin: async () => { starts++; state = { status: 'running', active: true, message: 'ブラウザで認証してください。' }; return state; },
    cancelCodexLogin: async () => { cancels++; state = { status: 'cancelled', active: false, message: '中断しました。' }; return state; },
    checkAuthStatus: async () => ({ status: 'login_required', label: 'ログインが必要', checkedAt: 'manual' }),
  },
};
const root = createRoot(document.getElementById('root'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function render() {
  root.render(<SettingsPane />);
  await wait(150);
  button('設定')?.click();
  await wait(100);
}
(async () => {
  try {
    await render();
    const start = button('Codexにログイン');
    assert(start && !start.disabled, 'start button available');
    start.click(); await wait(80);
    assert(starts === 1 && button('Codexにログイン').disabled, 'duplicate starts disabled');
    assert(button('ログインを中断'), 'cancel available');
    button('ログインを中断').click(); await wait(80);
    assert(cancels === 1 && !button('Codexにログイン').disabled, 'cancel permits retry');
    button('Codexにログイン').click(); await wait(80);
    state = { status: 'completed', active: false, message: '認証完了', authStatus: { ok: true, status: 'available', label: '利用可能', message: '認証情報を確認しました。', checkedAt: 'auto' } };
    await wait(1100);
    assert(document.body.textContent.includes('認証完了') && !button('Codexにログイン').disabled, 'completion displayed');
    button('再確認').click(); await wait(1200);
    assert(document.body.textContent.includes('ログインが必要'), 'manual auth check not overwritten by polling');
    root.render(null); await wait(80); await render();
    assert(document.body.textContent.includes('認証完了'), 'state retained after settings reopen');
    assert(document.body.textContent.includes('無料プランでのCotaska動作は未検証'), 'conditions displayed');
    window.parallelResult = { ok: true, checks: 8, starts, cancels };
  } catch (error) { window.parallelResult = { ok: false, error: error.message }; }
})();
