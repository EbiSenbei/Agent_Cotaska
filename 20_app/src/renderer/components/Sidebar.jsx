import React from "react";

function Sidebar({ activeIcon, onIconClick, updateAlert }) {
  const primaryIcons = [
    { title: "リスト", emoji: "📋" },
    { title: "検索", emoji: "🔍" },
  ];
  const hasUpdate = Boolean(updateAlert?.hasUpdate);
  const updateTitle = updateAlert?.latestVersion
    ? `新しいバージョンがあります: ${updateAlert.latestVersion}`
    : (updateAlert?.message || "新しいバージョンがあります");

  return (
    <div className="sidebar">
      <div className="avatar">C</div>
      {hasUpdate && (
        <button
          type="button"
          className="sb-icon sb-icon--update-alert"
          title={updateTitle}
          aria-label={updateTitle}
          onClick={() => onIconClick?.("設定")}
        >
          ↻
        </button>
      )}

      {primaryIcons.map(({ title, emoji }) => (
        <div
          key={title}
          className={`sb-icon${activeIcon === title ? " active" : ""}`}
          title={title}
          onClick={() => onIconClick?.(title)}
        >
          {emoji}
        </div>
      ))}

      <div className="sb-spacer" />
      <div className="sb-bottom">
        <div
          className={`sb-icon sb-icon--settings${activeIcon === "設定" ? " active" : ""}`}
          title="設定"
          onClick={() => onIconClick?.("設定")}
        >
          ⚙
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
