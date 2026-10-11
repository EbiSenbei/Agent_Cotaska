const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDocumentPreviewService, MAX_BYTES } = require('./documentPreview');
let dir;
const pdf = Buffer.from('%PDF-1.7\nfixture');
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-preview-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
function setup(name, bytes, options = {}) {
  const source = path.join(dir, name);
  fs.writeFileSync(source, bytes);
  const attachments = { file: (id, value) => { if (id !== 'T-1' || value !== name || !fs.existsSync(source)) throw new Error('添付がありません'); return source; } };
  return createDocumentPreviewService({ attachments, ...options });
}
test('PDF bytes are read locally with Japanese paths and original intact', async () => {
  const service = setup('日本語 資料.PDF', pdf);
  expect(Buffer.from((await service.preview('T-1', '日本語 資料.PDF')).bytes)).toEqual(pdf);
  expect(fs.readFileSync(path.join(dir, '日本語 資料.PDF'))).toEqual(pdf);
  await expect(service.preview('T-1', '../資料.pdf')).rejects.toThrow();
});
test('invalid PDF and oversized documents are rejected', async () => {
  const service = setup('bad.pdf', 'broken');
  await expect(service.preview('T-1', 'bad.pdf')).rejects.toThrow('PDF');
  fs.truncateSync(path.join(dir, 'bad.pdf'), MAX_BYTES + 1);
  await expect(service.preview('T-1', 'bad.pdf')).rejects.toThrow('50MB');
});
test('PowerPoint without LibreOffice gives actionable explanation', async () => {
  const service = setup('資料.pptx', 'slides', { findConverter: () => null });
  await expect(service.preview('T-1', '資料.pptx')).rejects.toThrow('LibreOffice');
});
test.each(['ppt', 'pptx'])('PowerPoint %s converts a copy and removes temporary files', async (ext) => {
  let temporary;
  const service = setup(`資料.${ext}`, 'slides', { findConverter: () => 'office', convert: async (input, output, profile) => {
    temporary = output;
    expect(fs.readFileSync(input, 'utf8')).toBe('slides');
    expect(fs.readFileSync(path.join(profile, 'user', 'registrymodifications.xcu'), 'utf8')).toContain('MacroSecurityLevel');
    fs.writeFileSync(path.join(output, 'document.pdf'), pdf);
  } });
  expect(Buffer.from((await service.preview('T-1', `資料.${ext}`)).bytes)).toEqual(pdf);
  expect(fs.existsSync(temporary)).toBe(false);
  expect(fs.readFileSync(path.join(dir, `資料.${ext}`), 'utf8')).toBe('slides');
});
test('conversion failure cleans up and keeps the source', async () => {
  let temporary;
  const service = setup('資料.pptx', 'slides', { findConverter: () => 'office', convert: async (_, output) => { temporary = output; throw new Error('conversion failed'); } });
  await expect(service.preview('T-1', '資料.pptx')).rejects.toThrow('conversion failed');
  expect(fs.existsSync(temporary)).toBe(false);
  expect(fs.readFileSync(path.join(dir, '資料.pptx'), 'utf8')).toBe('slides');
});
test('missing output and removed attachment during conversion are rejected', async () => {
  const service = setup('資料.pptx', 'slides', { findConverter: () => 'office', convert: async () => {} });
  await expect(service.preview('T-1', '資料.pptx')).rejects.toThrow('変換できません');
  const removed = setup('資料.pptx', 'slides', { findConverter: () => 'office', convert: async (_, output) => {
    fs.writeFileSync(path.join(output, 'document.pdf'), pdf);
    fs.unlinkSync(path.join(dir, '資料.pptx'));
  } });
  await expect(removed.preview('T-1', '資料.pptx')).rejects.toThrow('添付');
});
