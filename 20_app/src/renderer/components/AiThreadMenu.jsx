import React, { useLayoutEffect, useRef } from "react";

export default function AiThreadMenu({ thread, x, y, archiveDisabledReason = "", onOpenFolder, onRename, onArchive, onRestore, onClose }) {
  const menuRef = useRef(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector("button:not(:disabled)")?.focus();
  }, [x, y]);

  const folderReason = thread.primaryTaskId ? "" : "このスレッドにはタスクが紐づいていません";
  return (
    <div ref={menuRef} className="ai-workdir-context-menu ai-thread-context-menu" style={{ left: x, top: y }}
      role="menu" aria-label="スレッド操作" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = [...menuRef.current.querySelectorAll("button:not(:disabled)")];
          const index = buttons.indexOf(document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      <button type="button" role="menuitem" disabled={Boolean(folderReason)} title={folderReason || undefined} onClick={onOpenFolder}>
        タスクフォルダを開く
      </button>
      {folderReason && <small className="ai-thread-menu-reason">{folderReason}</small>}
      <button type="button" role="menuitem" onClick={onRename}>スレッドの名前を変更</button>
      <div role="separator" className="ai-thread-menu-separator" />
      {thread.status === "archived" ? (
        <button type="button" role="menuitem" onClick={onRestore}>スレッドを復元</button>
      ) : (
        <>
          <button type="button" role="menuitem" disabled={Boolean(archiveDisabledReason)} title={archiveDisabledReason || undefined} onClick={onArchive}>
            このスレッドをアーカイブ
          </button>
          {archiveDisabledReason && <small className="ai-thread-menu-reason">{archiveDisabledReason}</small>}
        </>
      )}
    </div>
  );
}
