import React from "react";

function Sidebar({ activeIcon, onIconClick, updateAlert }) {
  const primaryIcons = [
    { title: "リスト", emoji: "📋" },
    { title: "検索", emoji: "🔍" },
    { title: "AI", emoji: "AI", className: "sb-icon--ai" },
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

      {primaryIcons.map(({ title, emoji, className }) => (
        <button
          type="button"
          key={title}
          className={`sb-icon${className ? ` ${className}` : ""}${activeIcon === title ? " active" : ""}`}
          title={title}
          aria-label={title}
          onClick={() => onIconClick?.(title)}
        >
          {emoji}
        </button>
      ))}

      <div className="sb-spacer" />
      <div className="sb-bottom">
        <button
          type="button"
          className={`sb-icon sb-icon--settings${activeIcon === "設定" ? " active" : ""}`}
          title="設定"
          aria-label="設定"
          onClick={() => onIconClick?.("設定")}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
