import React, { useId, useRef, useState } from 'react';

export default function AttachmentMenu({ file, busy, readOnly, onAction }) {
  const id = useId();
  const panel = useRef(null);
  const [position, setPosition] = useState({});
  function action(name) {
    panel.current?.hidePopover();
    onAction(name, file.name);
  }
  return <>
    <button type="button" disabled={busy} popoverTarget={id} aria-label={`${file.name}の操作`} aria-haspopup="true"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 124)), left: Math.max(8, Math.min(rect.right - 200, window.innerWidth - 208)) });
      }}>…</button>
    <div ref={panel} id={id} popover="auto" className="task-attachment-menu" style={position} aria-label={`${file.name}の操作`}>
      <button type="button" disabled={busy} onClick={() => action('open')}>外部アプリで開く</button>
      <button type="button" disabled={busy} onClick={() => action('reveal')}>エクスプローラを開く</button>
      <button type="button" disabled={busy || readOnly || file.isAiChat} title={file.isAiChat ? 'チャット画像はAIチャットから整理できます' : '添付ファイルをWindowsのごみ箱へ移動します'} onClick={() => action('delete')}>ファイルを削除する</button>
    </div>
  </>;
}
