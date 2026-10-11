import React, { useState } from "react";

export default function AiImagePreview({ file }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="ai-file-preview-image">
      {failed ? <p className="ai-muted-text" role="alert">画像を読み込めませんでした。外部アプリで開いて確認してください。</p> :
        <img src={file.url} alt={file.label || "画像"} onError={() => setFailed(true)} />}
    </div>
  );
}
