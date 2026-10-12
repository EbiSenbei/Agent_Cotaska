import React, { useEffect, useState } from 'react';

export default function AiImageThumbnail({ filePath }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    setUrl('');
    window.cotaskaAPI?.aiChat?.previewFile?.(filePath)?.then((result) => {
      if (active && result?.ok && result.preview_type === 'image') setUrl(result.url);
    }).catch(() => {});
    return () => { active = false; };
  }, [filePath]);
  return url ? <img className="ai-image-thumbnail" src={url} alt="" /> : <span aria-hidden="true">▧</span>;
}
