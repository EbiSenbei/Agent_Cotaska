// A transition owns the project context until initialization completes. AI claims
// include provider startup and cancellation finalizers, not only active SDK runs.
function createProjectOperationGuard() {
  let changing = false;
  let runs = 0;
  return {
    beginRun() {
      if (changing) throw new Error('プロジェクトを切り替えています。完了後に送信してください。');
      runs += 1;
      let released = false;
      return () => { if (!released) { released = true; runs -= 1; } };
    },
    beginTransition() {
      if (changing) throw new Error('プロジェクトの切替が進行中です。');
      if (runs) throw new Error('AIの処理中はプロジェクトを切り替えられません。応答または中断の完了を待ってください。');
      changing = true;
      return () => { changing = false; };
    },
  };
}
module.exports = { createProjectOperationGuard };
