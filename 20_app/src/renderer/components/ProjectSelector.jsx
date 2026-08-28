import React, { useEffect, useState } from "react";
import "../styles/project-selector.css";

export default function ProjectSelector({ onOpened }) {
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setRecent(await window.cotaskaAPI.projects.listRecent());
  useEffect(() => { refresh(); }, []);
  const run = async (action) => {
    setBusy(true); setError("");
    try { const result = await action(); if (result?.ok) onOpened(result.project); else if (!result?.canceled) setError(result?.error || "プロジェクトを開けませんでした。"); }
    finally { setBusy(false); }
  };
  return <div className="project-selector-shell">
    <header className="project-selector-top"><span className="project-selector-logo">C</span><strong>Cotaska</strong></header>
    <main className="project-selector-main">
      <h1>プロジェクトを選択</h1>
      <p>Cotaskaで管理するフォルダを開くか、新しいプロジェクトを作成します。</p>
      {error && <div className="project-selector-error" role="alert">{error}</div>}
      <div className="project-selector-actions">
        <button disabled={busy} onClick={() => run(() => window.cotaskaAPI.projects.chooseAndOpen())}><b>既存プロジェクトを開く</b><span>project.yamlがある任意フォルダを選択</span></button>
        <button disabled={busy} onClick={() => run(() => window.cotaskaAPI.projects.chooseAndCreate({ name: "cotaska" }))}><b>新しいプロジェクトを作成</b><span>指定フォルダ直下にCotaskaデータを作成</span></button>
      </div>
      <button className="project-selector-migrate" disabled={busy} onClick={() => run(() => window.cotaskaAPI.projects.migrateLegacy())}>旧Cotaska Portableから移行</button>
      <div className="project-selector-heading"><h2>最近使ったプロジェクト</h2><span>最終利用順</span></div>
      <div className="project-selector-list">
        {recent.length === 0 && <div className="project-selector-empty">最近使ったプロジェクトはありません。</div>}
        {recent.map((item) => <article key={item.projectId} className={!item.exists ? "missing" : ""}>
          <span className="project-selector-mark">{item.exists ? item.name.slice(0, 1) : "!"}</span>
          <div><strong>{item.name}</strong>{!item.exists && <em>見つかりません</em>}<small>{item.path}</small></div>
          {item.exists ? <button disabled={busy} onClick={() => run(() => window.cotaskaAPI.projects.openRecent(item.projectId))}>開く</button> : <button disabled={busy} onClick={() => run(() => window.cotaskaAPI.projects.chooseAndOpen())}>再選択</button>}
          <button className="project-selector-remove" aria-label={`${item.name}を履歴から削除`} onClick={async () => { await window.cotaskaAPI.projects.removeRecent(item.projectId); refresh(); }}>×</button>
        </article>)}
      </div>
    </main>
  </div>;
}
