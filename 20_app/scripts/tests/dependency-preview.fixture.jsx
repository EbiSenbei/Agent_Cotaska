import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentPreview from '../../src/renderer/components/DocumentPreview';
import AiMarkdownPreview from '../../src/renderer/components/AiMarkdownPreview';

// A real PDF page with a blue rectangle, without font or network dependencies.
function pdfBytes() {
  const stream = '0 0 1 rg 20 20 100 80 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 250 200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
window.cotaskaAPI = { attachments: {
  preview: async () => ({ ok: true, result: { bytes: pdfBytes() } }),
  onChanged: () => () => {},
} };
let openedTask;
function Fixture() {
  const [open, setOpen] = useState(true);
  return <><AiMarkdownPreview content={'# Dependency check\n\n**visible** T-0791\n\n<script>window.unsafe=true</script>'} onOpenTask={id => { openedTask = id; }} />
    {open && <DocumentPreview taskId="T-0791" name="preview.pdf" onClose={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
const waitFor = async (check) => {
  const deadline = Date.now() + 15000;
  while (!check()) {
    const error = document.querySelector('[role="alert"]');
    if (error) throw new Error(error.textContent);
    if (Date.now() > deadline) throw new Error('Preview check timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
(async () => {
  await waitFor(() => document.querySelector('canvas')?.width > 300 && document.querySelector('[aria-busy="false"]'));
  const canvas = document.querySelector('canvas');
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  if (!pixels.some((value, i) => i % 4 === 2 && value === 255 && pixels[i - 1] === 0 && pixels[i - 2] === 0)) throw new Error('PDF page was not painted');
  const width = canvas.width;
  document.querySelector('[aria-label="拡大"]').click();
  await waitFor(() => canvas.width > width && document.querySelector('[aria-busy="false"]'));
  [...document.querySelectorAll('button')].find(button => button.textContent === '閉じる').click();
  await waitFor(() => !document.querySelector('dialog'));
  if (document.querySelector('.ai-message-markdown strong')?.textContent !== 'visible' || window.unsafe) throw new Error('Markdown rendering failed');
  document.querySelector('[data-task-id="T-0791"]').click();
  if (openedTask !== 'T-0791') throw new Error('Markdown task link failed');
  window.parallelResult = { ok: true, checks: 'PDF worker load, page rasterization, zoom, close, Markdown formatting, HTML escaping, task links' };
})().catch(error => { window.parallelResult = { ok: false, error: String(error.stack || error) }; });
