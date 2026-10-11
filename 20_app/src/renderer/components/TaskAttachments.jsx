import React, { useEffect, useRef, useState } from 'react';

export default function TaskAttachments({ taskId, readOnly = false, onPreview }) {
  const [data, setData] = useState({ files: [], removed: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef(taskId);
  current.current = taskId;
  const api = window.cotaskaAPI?.attachments;

  useEffect(() => {
    let active = true;
    setData({ files: [], removed: [] });
    setError('');
    setBusy(false);
    async function refresh() {
      if (!api) return;
      try {
        const response = await api.list(taskId);
        if (!active) return;
        if (response.ok) setData(response.result);
        else setError(response.error);
      } catch (err) { if (active) setError(err.message); }
    }
    refresh();
    const unsubscribe = api?.onChanged(({ taskId: changedId }) => { if (changedId === taskId) refresh(); });
    return () => { active = false; unsubscribe?.(); };
  }, [taskId, api]);

  async function run(action, value) {
    if (!api || busy) return;
    const id = taskId;
    setBusy(true);
    setError('');
    try {
      const response = await api[action](id, value);
      if (!response.ok) throw new Error(response.error);
      const refreshed = await api.list(id);
      if (current.current !== id) return;
      if (!refreshed.ok) throw new Error(refreshed.error);
      setData(refreshed.result);
    } catch (err) { if (current.current === id) setError(err.message); }
    finally { if (current.current === id) setBusy(false); }
  }

  return (
    <section className="task-attachments" aria-label="添付ファイル" aria-busy={busy}>
      <div className="task-attachments-heading">
        <strong>添付ファイル <span>({data.files.length})</span></strong>
        <button type="button" disabled={readOnly || busy || !api} onClick={() => run('add')}>ファイルを追加</button>
      </div>
      {error && <p className="task-attachments-error" role="alert">{error}</p>}
      {!data.files.length && <p className="task-attachments-empty">添付ファイルはありません</p>}
      <ul className="task-attachments-list">
        {data.files.map((file) => (
          <li key={file.name}>
            <button type="button" className="task-attachment-name" disabled={busy} title={file.name} onClick={() => run('open', file.name)}>{file.name}</button>
            <span>{file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}</span>
            {/\.(pdf|pptx?)$/i.test(file.name) && <button type="button" disabled={busy} onClick={() => onPreview?.(file.name)}>プレビュー</button>}
            <button type="button" disabled={readOnly || busy} title="取り外したファイルは復元できます" onClick={() => run('remove', file.name)}>取り外す</button>
          </li>
        ))}
      </ul>
      {!!data.removed.length && (
        <details>
          <summary>取り外したファイル ({data.removed.length})</summary>
          <ul className="task-attachments-list">
            {data.removed.map((file) => <li key={file.token}><span className="task-attachment-name">{file.name}</span><button type="button" disabled={readOnly || busy} onClick={() => run('restore', file.token)}>復元</button></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
