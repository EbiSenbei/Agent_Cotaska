// CLIの生出力には認証URL等が含まれるため、収集・表示・ログ記録しない。
function createCodexLogin({ spawn, resolveBinary, buildEnv, checkAuthStatus, timeoutMs = 5 * 60 * 1000 }) {
  let active = null;
  let state = { status: 'idle', message: '「Codexにログイン」からブラウザ認証を開始できます。' };
  const getStatus = () => ({ ...state, active: Boolean(active) });
  function start() {
    if (active) return getStatus();
    const session = { child: null, timer: null, stopped: null };
    active = session;
    state = { status: 'running', message: '既定のブラウザで認証を完了してください。ブラウザを閉じた場合は中断して再試行できます（5分で時間切れ）。' };
    const finish = async (code, failed = false) => {
      if (active !== session || session.finishing) return;
      session.finishing = true;
      clearTimeout(session.timer);
      if (session.stopped) {
        state = { status: session.stopped, message: session.stopped === 'timeout' ? '時間切れです。「Codexにログイン」で再試行してください。' : '中断しました。「Codexにログイン」で再試行できます。' };
      } else if (failed || code !== 0) {
        state = { status: 'failed', message: 'ログインに失敗しました。ネットワークと既定のブラウザ、組織のログイン制限を確認して再試行してください。' };
      } else {
        state = { status: 'checking', message: '認証状態を確認しています。' };
        try {
          const authStatus = await checkAuthStatus();
          state = { status: authStatus.ok ? 'completed' : 'failed', message: authStatus.ok ? '認証情報を確認しました。作業フォルダ・モデル・権限を選び、AIチャットから送信してください。モデルの利用権・利用枠は送信時に確認されます。' : 'ログイン処理は終了しましたが認証を確認できません。「再確認」または再ログインしてください。', authStatus };
        } catch (_) {
          state = { status: 'failed', message: '認証確認に失敗しました。「再確認」で確認してください。' };
        }
      }
      active = null;
    };
    try {
      const binary = resolveBinary();
      session.child = spawn(binary.command, [...(binary.argsPrefix || []), 'login'], {
        env: buildEnv(binary) || process.env, windowsHide: true, shell: false, stdio: 'ignore',
      });
      session.child.once('error', () => { void finish(null, true); });
      session.child.once('close', (code) => { void finish(code); });
      session.timer = setTimeout(() => {
        if (active === session && !session.finishing) { session.stopped = 'timeout'; session.child.kill(); }
      }, timeoutMs);
      session.timer.unref?.();
    } catch (_) { void finish(null, true); }
    return getStatus();
  }
  function cancel() {
    if (active && !active.finishing && !active.stopped) {
      active.stopped = 'cancelled';
      state = { status: 'stopping', message: 'ログイン処理を中断しています。' };
      active.child?.kill();
    }
    return getStatus();
  }
  return { start, cancel, getStatus };
}
module.exports = { createCodexLogin };
