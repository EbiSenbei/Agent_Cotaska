const { performAttachmentFileAction: run } = require('./attachmentFileActions');
function services(deleted = false) {
  return { taskService: { getTaskById: () => ({ delete_flag: deleted ? 1 : 0 }) }, attachmentService: { file: vi.fn(() => 'D:\\task\\attachments\\a.txt') }, shell: { trashItem: vi.fn(async () => {}), showItemInFolder: vi.fn() } };
}
test('delete sends only the resolved attachment copy to OS trash', async () => {
  const s = services();
  await run(s, 'delete', 'T-0579', 'a.txt');
  expect(s.attachmentService.file).toHaveBeenCalledWith('T-0579', 'a.txt');
  expect(s.shell.trashItem).toHaveBeenCalledWith('D:\\task\\attachments\\a.txt');
});
test('reveal selects the attachment in Explorer', async () => {
  const s = services();
  await run(s, 'reveal', 'T-0579', 'a.txt');
  expect(s.shell.showItemInFolder).toHaveBeenCalledWith('D:\\task\\attachments\\a.txt');
});
test('readonly and chat history files are not trashed', async () => {
  const s = services(true);
  await expect(run(s, 'delete', 'T-0579', 'a.txt')).rejects.toThrow();
  await expect(run(services(), 'delete', 'T-0579', 'ai-chat/image.png')).rejects.toThrow();
  expect(s.shell.trashItem).not.toHaveBeenCalled();
});
test('failed path validation or OS trash fails without reporting success', async () => {
  const s = services();
  s.attachmentService.file.mockImplementationOnce(() => { throw new Error('invalid path'); });
  await expect(run(s, 'delete', 'T-0579', '../a.txt')).rejects.toThrow('invalid path');
  expect(s.shell.trashItem).not.toHaveBeenCalled();
  s.shell.trashItem.mockRejectedValue(new Error('locked'));
  await expect(run(s, 'delete', 'T-0579', 'a.txt')).rejects.toThrow('locked');
});
