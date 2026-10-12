async function performAttachmentFileAction({ taskService, attachmentService, shell }, action, id, name) {
  if (action === 'delete') {
    if (taskService.getTaskById(id)?.delete_flag === 1) throw new Error('ゴミ箱内のタスクの添付は削除できません。');
    if (String(name).startsWith('ai-chat/')) throw new Error('チャット画像はAIチャットから整理してください。');
    await shell.trashItem(attachmentService.file(id, name));
  } else if (action === 'reveal') {
    shell.showItemInFolder(attachmentService.file(id, name));
  } else throw new Error('不明なファイル操作です。');
}
module.exports = { performAttachmentFileAction };
