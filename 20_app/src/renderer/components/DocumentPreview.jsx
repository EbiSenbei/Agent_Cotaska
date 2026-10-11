import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './DocumentPreview.css';

export function documentAttachmentName(reference) {
  try {
    const value = decodeURIComponent(reference);
    const match = /^attachments\/([^/\\:\x00-\x1f]+\.(?:pdf|pptx?))$/i.exec(value);
    return match?.[1] || null;
  } catch { return null; }
}

export default function DocumentPreview({ taskId, name, onClose }) {
  const dialog = useRef(null);
  const canvas = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { dialog.current?.close(); previous?.focus?.(); };
  }, []);
  useEffect(() => {
    let active = true;
    let documentTask;
    let workerPort;
    setPdf(null); setPage(1); setZoom(1); setError(''); setLoading(true);
    (async () => {
      try {
        const response = await window.cotaskaAPI.attachments.preview(taskId, name);
        if (!active) return;
        if (!response.ok) throw new Error(response.error);
        const library = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        if (!active) return;
        // Explicit port avoids PDF.js creating a blob worker for Electron file:// origins.
        workerPort = new Worker(worker.default, { type: 'module' });
        library.GlobalWorkerOptions.workerPort = workerPort;
        const assets = new URL('pdfjs/', document.baseURI).href;
        documentTask = library.getDocument({ data: new Uint8Array(response.result.bytes), cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, isEvalSupported: false });
        documentTask.onPassword = () => { if (active) { setError('パスワードで保護されたPDFは外部アプリで開いてください。'); setLoading(false); } documentTask.destroy(); };
        const doc = await documentTask.promise;
        if (active) setPdf(doc);
      } catch (err) { if (active) setError((err.name === 'PasswordException' ? '保護付きPDFは外部アプリで開いてください。' : err.message) || '資料を読み込めません。'); }
      finally { if (active) setLoading(false); }
    })();
    const unsubscribe = window.cotaskaAPI.attachments.onChanged(({ taskId: id }) => {
      if (id === taskId) onClose();
    });
    return () => { active = false; documentTask?.destroy().finally(() => workerPort?.terminate()); if (!documentTask) workerPort?.terminate(); unsubscribe?.(); };
  }, [taskId, name]);
  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let renderingTask;
    setRendering(true);
    (async () => {
      try {
        const sheet = await pdf.getPage(page);
        if (!active) return;
        const natural = sheet.getViewport({ scale: 1 });
        const fit = Math.min(1.5, Math.max(200, dialog.current.clientWidth - 64) / natural.width);
        const viewport = sheet.getViewport({ scale: fit * zoom });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
        const target = canvas.current;
        target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
        target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
        renderingTask = sheet.render({ canvasContext: target.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await renderingTask.promise;
      } catch (err) { if (active && err.name !== 'RenderingCancelledException') setError(`ページを表示できません: ${err.message}`); }
      finally { if (active) setRendering(false); }
    })();
    return () => { active = false; renderingTask?.cancel(); };
  }, [pdf, page, zoom]);
  async function openExternal() {
    try {
      const response = await window.cotaskaAPI.attachments.open(taskId, name);
      if (!response.ok) setError(response.error);
    } catch (err) { setError(err.message); }
  }
  const slides = /\.pptx?$/i.test(name);
  return createPortal(<dialog className="document-preview" ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={`${name}のプレビュー`}>
    <header><strong title={name}>{name}</strong><button onClick={openExternal}>外部アプリで開く</button><button autoFocus onClick={onClose}>閉じる</button></header>
    <nav aria-label={slides ? 'スライド操作' : 'ページ操作'}>
      <button disabled={!pdf || page <= 1 || rendering} onClick={() => setPage(page - 1)}>前へ</button>
      <span>{slides ? 'スライド' : 'ページ'} {pdf ? `${page} / ${pdf.numPages}` : '—'}</span>
      <button disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => setPage(page + 1)}>次へ</button>
      <button disabled={!pdf || zoom <= 0.25 || rendering} onClick={() => setZoom(zoom - 0.25)} aria-label="縮小">−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button disabled={!pdf || zoom >= 3 || rendering} onClick={() => setZoom(zoom + 0.25)} aria-label="拡大">＋</button>
      <button disabled={!pdf || rendering} onClick={() => setZoom(1)}>幅に合わせる</button>
    </nav>
    {loading && <p role="status">{slides ? 'スライドを変換しています（最大60秒）…' : 'PDFを読み込んでいます…'}</p>}
    {error && <p className="document-preview-error" role="alert">{error}</p>}
    {slides && <p className="document-preview-note">静止画として表示します。アニメーション・動画は再生されず、字体や配置が変わる場合があります。</p>}
    <div className="document-preview-page" aria-busy={rendering}><canvas ref={canvas} hidden={!pdf || !!error} aria-label={`${slides ? 'スライド' : 'ページ'} ${page}`} /></div>
  </dialog>, document.body);
}
