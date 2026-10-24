const { readClipboardPng } = require('../../src/main/clipboardImage');

function fixture(types = ['image/png'], blob = new Blob(['image'])) {
  const getType = vi.fn(async () => blob);
  const clipboard = { read: vi.fn(async () => [{ types, getType }]) };
  const png = Buffer.from('normalized PNG');
  const nativeImage = { createFromBuffer: vi.fn(() => ({ isEmpty: () => false, toPNG: () => png })) };
  return { clipboard, nativeImage, getType, png };
}

test('Electron 44 async ClipboardItem image is decoded and normalized to PNG', async () => {
  const f = fixture(['text/plain', 'image/jpeg', 'image/png']);
  expect(await readClipboardPng(f.clipboard, f.nativeImage)).toEqual(f.png);
  expect(f.getType).toHaveBeenCalledWith('image/png');
  expect(f.nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from('image'));
});

test('non-PNG image is converted and text-only items are skipped', async () => {
  const f = fixture(['image/jpeg']);
  const read = f.clipboard.read;
  f.clipboard.read = async () => [{ types: ['text/plain'] }, ...(await read())];
  expect(await readClipboardPng(f.clipboard, f.nativeImage)).toEqual(f.png);
  expect(f.getType).toHaveBeenCalledWith('image/jpeg');
});

test('text-only clipboard produces a clear error without decoding', async () => {
  const f = fixture(['text/plain']);
  await expect(readClipboardPng(f.clipboard, f.nativeImage)).rejects.toThrow('画像がありません');
  expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled();
});

test('read failure is propagated', async () => {
  const f = fixture();
  f.clipboard.read.mockRejectedValue(new Error('read failed'));
  await expect(readClipboardPng(f.clipboard, f.nativeImage)).rejects.toThrow('read failed');
});

test('invalid decoded image is rejected', async () => {
  const f = fixture();
  f.nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => true });
  await expect(readClipboardPng(f.clipboard, f.nativeImage)).rejects.toThrow('読み込めません');
});

test('oversized input and output are rejected', async () => {
  const f = fixture(['image/png'], { size: 20 * 1024 * 1024 + 1 });
  await expect(readClipboardPng(f.clipboard, f.nativeImage)).rejects.toThrow('20MB');
  expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled();
  const output = fixture();
  output.nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => false, toPNG: () => ({ length: 20 * 1024 * 1024 + 1 }) });
  await expect(readClipboardPng(output.clipboard, output.nativeImage)).rejects.toThrow('20MB');
});
