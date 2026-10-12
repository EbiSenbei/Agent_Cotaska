const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function readClipboardPng(clipboard, nativeImage) {
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.includes('image/png') ? 'image/png' : item.types.find((value) => value.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('画像は20MB以下で貼り付けてください。');
    const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    if (image.isEmpty()) throw new Error('クリップボードの画像を読み込めません。');
    const png = image.toPNG();
    if (!png.length || png.length > MAX_IMAGE_BYTES) throw new Error('画像は20MB以下で貼り付けてください。');
    return png;
  }
  throw new Error('クリップボードに画像がありません。');
}

module.exports = { readClipboardPng };
