const { createClipboardImageName } = require('../../src/main/clipboardImageName');

test('clipboard filenames use local calendar time, padded fields and a random 12-digit ID', () => {
  const now = new Date(2026, 0, 2, 3, 4, 5);
  const first = createClipboardImageName('png', now);
  const second = createClipboardImageName('png', now);
  expect(first).toMatch(/^clip-image_20260102_030405_[0-9a-f]{12}\.png$/);
  expect(second).not.toBe(first);
  expect(createClipboardImageName('webp', now)).toMatch(/^clip-image_20260102_030405_[0-9a-f]{12}\.webp$/);
});
