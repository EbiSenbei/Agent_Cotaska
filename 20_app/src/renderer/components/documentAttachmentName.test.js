import { documentAttachmentName } from './DocumentPreview';

test('only task attachment document links enter the internal viewer', () => {
  expect(documentAttachmentName('attachments/%E8%B3%87%E6%96%99%20A.PDF')).toBe('資料 A.PDF');
  expect(documentAttachmentName('attachments/資料.pptx')).toBe('資料.pptx');
  for (const value of ['https://example.com/slides.pptx', '../attachments/slides.pdf', 'attachments/a%2Fb.pdf', 'attachments/a%5Cb.pdf', 'attachments/a%00.pdf', 'attachments/a%3Ab.pdf', 'attachments/%.pdf', 'attachments/photo.png']) {
    expect(documentAttachmentName(value)).toBeNull();
  }
});
