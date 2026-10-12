const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const projectContext = require('./projectContext');

const PREFIX = 'cotaska-image:';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const WARNING_BYTES = 500 * 1024 * 1024;
const NAME = /^clip-image_\d{8}_\d{6}_[0-9a-f]{12}\.(png|jpg|webp)$/;
const THREAD = /^thread_[0-9a-f-]{36}$/;

function imageFormat(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR') return { extension: 'png', mime: 'image/png' };
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.length >= 16 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  throw new Error('PNG・JPEG・WebPの画像だけを添付できます。');
}

function validateImage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('画像は1枚10MiB以内にしてください。');
  return imageFormat(bytes);
}

// Check every existing parent: junctions and symlinks must never redirect writes or cleanup.
function safePath(root, relative, create = false) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('画像の保存先が不正です。');
  let current = root;
  for (const part of ['', ...rel.split(path.sep)]) {
    if (part) current = path.join(current, part);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('リンク先には画像を保存できません。');
    }
  }
  if (create) fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

function parseLocator(locator) {
  if (typeof locator !== 'string' || !locator.startsWith(PREFIX)) return null;
  const parts = locator.slice(PREFIX.length).split('/');
  const task = parts[0] === 'task';
  const [thread, name] = task ? parts.slice(2) : parts.slice(1);
  if ((task ? parts.length !== 4 || !/^T-\d+$/.test(parts[1]) : parts.length !== 3 || parts[0] !== 'chat') || !THREAD.test(thread || '') || !NAME.test(name || '')) throw new Error('画像の参照が不正です。');
  return { taskId: task ? parts[1] : null, thread, name };
}

function resolveImage(locator) {
  const info = parseLocator(locator);
  if (!info) throw new Error('管理対象の画像ではありません。');
  const project = projectContext.getCurrent();
  let relative = info.taskId ? `tasks/${info.taskId}/attachments/ai-chat/${info.thread}/${info.name}` : `ai-chat/images/${info.thread}/${info.name}`;
  const manifestPath = safePath(project.rootDir, 'ai-chat/image-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))[locator];
    if (saved) {
      if (typeof saved !== 'string' || !(info.taskId ? saved.startsWith('tasks/') && saved.endsWith(`/${info.taskId}/attachments/ai-chat/${info.thread}/${info.name}`) : saved === relative)) throw new Error('画像管理情報が不正です。');
      relative = saved;
    }
  }
  const file = safePath(project.rootDir, relative);
  if (fs.existsSync(file)) return file;
  if (!info.taskId) throw new Error('画像が見つかりません。');
  const zipPath = safePath(project.rootDir, `archive/${info.taskId}/attachments.zip`);
  if (!fs.existsSync(zipPath)) throw new Error('画像が見つかりません。');
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(`ai-chat/${info.thread}/${info.name}`);
  if (!entry || entry.header.size > MAX_IMAGE_BYTES) throw new Error('アーカイブ画像が不正です。');
  const bytes = entry.getData();
  validateImage(bytes);
  const cache = safePath(project.rootDir, `ai-chat/image-cache/${crypto.createHash('sha256').update(bytes).digest('hex')}/${info.name}`, true);
  if (!fs.existsSync(cache)) fs.writeFileSync(cache, bytes, { flag: 'wx' });
  return cache;
}

function createImageStore(aiService, taskService, isThreadBusy = (id) => aiService.listRuns(id).some((run) => run.run_status === 'running')) {
  function manifestFile() { return safePath(projectContext.getCurrent().rootDir, 'ai-chat/image-manifest.json', true); }
  function readManifest() {
    const file = manifestFile();
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }
  function writeManifest(manifest) {
    const file = manifestFile();
    const temporary = safePath(projectContext.getCurrent().rootDir, 'ai-chat/image-manifest.tmp', true);
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2));
    fs.renameSync(temporary, file);
  }
  function save(threadId, inputs, maxFiles = 10) {
    const thread = aiService.getThread(threadId);
    if (!thread || thread.thread_status === 'archived' || !THREAD.test(threadId)) throw new Error('画像を追加できるチャットが見つかりません。');
    if (isThreadBusy(threadId)) throw new Error('AI応答中は画像を追加できません。');
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxFiles) throw new Error('画像の件数上限を超えています。');
    const refs = aiService.listReferences(threadId).filter((ref) => ref.ref_type === 'file');
    if (refs.length + inputs.length > maxFiles) throw new Error('参照ファイルの件数上限を超えています。');
    const images = inputs.map((input) => {
      if (typeof input?.base64 !== 'string' || input.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error('画像データが不正です。');
      const bytes = Buffer.from(input.base64, 'base64');
      return { bytes, ...validateImage(bytes) };
    });
    const existingBytes = refs.filter((ref) => parseLocator(ref.file_path)).reduce((sum, ref) => sum + fs.statSync(resolveImage(ref.file_path)).size, 0);
    if (existingBytes + images.reduce((sum, image) => sum + image.bytes.length, 0) > MAX_TOTAL_BYTES) throw new Error('画像の合計は20MiB以内にしてください。');
    const project = projectContext.getCurrent();
    const taskId = thread.primary_task_id;
    if (taskId) {
      const task = taskService.getTaskById(taskId);
      if (!task || task.delete_flag || task.is_invalid) throw new Error('関連タスクへ画像を保存できません。');
      taskService.ensureTaskFolder(taskId);
    }
    const folder = taskId ? path.relative(project.rootDir, taskService.getTaskBaseDir(taskId)).replace(/\\/g, '/') + `/attachments/ai-chat/${threadId}` : `ai-chat/images/${threadId}`;
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const added = [];
    try {
      for (const image of images) {
        const name = `clip-image_${stamp}_${crypto.randomBytes(6).toString('hex')}.${image.extension}`;
        const file = safePath(project.rootDir, `${folder}/${name}`, true);
        const manifest = readManifest();
        fs.writeFileSync(file, image.bytes, { flag: 'wx' });
        const locator = `${PREFIX}${taskId ? `task/${taskId}` : 'chat'}/${threadId}/${name}`;
        manifest[locator] = `${folder}/${name}`;
        try { writeManifest(manifest); } catch (error) { fs.unlinkSync(file); throw error; }
        try { added.push(aiService.addReference({ thread_id: threadId, ref_type: 'file', file_path: locator, label: name })); }
        catch (error) { fs.unlinkSync(file); throw error; }
      }
      return { ok: true, references: added, ...usage() };
    } catch (error) {
      for (const ref of added) remove(ref.reference_id);
      throw error;
    }
  }

  function retainedLocators() {
    const locators = new Set();
    for (const thread of aiService.listThreads({ includeArchived: true })) {
      for (const ref of aiService.listReferences(thread.thread_id)) if (parseLocator(ref.file_path)) locators.add(ref.file_path);
      for (const message of aiService.listMessages(thread.thread_id)) for (const attachment of message.attachments || []) if (parseLocator(attachment.filePath)) locators.add(attachment.filePath);
    }
    return locators;
  }

  function remove(referenceId) {
    const threads = aiService.listThreads({ includeArchived: true });
    const ref = threads.flatMap((thread) => aiService.listReferences(thread.thread_id)).find((entry) => entry.reference_id === referenceId);
    const result = aiService.removeReference(referenceId);
    if (ref && parseLocator(ref.file_path) && !retainedLocators().has(ref.file_path)) {
      cleanup([ref.file_path]);
    }
    return { ...result, taskId: ref ? parseLocator(ref.file_path)?.taskId : null };
  }

  function managedFiles() {
    const project = projectContext.getCurrent();
    const files = [];
    function walk(dir) {
      if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && NAME.test(entry.name)) files.push(file);
      }
    }
    walk(safePath(project.rootDir, 'ai-chat/images'));
    walk(safePath(project.rootDir, 'ai-chat/image-cache'));
    for (const [locator, relative] of Object.entries(readManifest())) {
      const info = parseLocator(locator);
      if (!info || typeof relative !== 'string' || !relative.endsWith(`/${info.thread}/${info.name}`)) throw new Error('画像管理情報が不正です。');
      const file = safePath(project.rootDir, relative);
      if (fs.existsSync(file) && !files.includes(file)) files.push(file);
    }
    if (fs.existsSync(project.tasksDir)) for (const entry of fs.readdirSync(project.tasksDir)) if (/^T-\d+$/.test(entry)) walk(safePath(project.rootDir, `tasks/${entry}/attachments/ai-chat`));
    return files;
  }

  function usage() {
    let bytes = managedFiles().reduce((sum, file) => sum + fs.statSync(file).size, 0);
    // Archived originals stay in the verified attachment ZIP and count toward usage.
    const project = projectContext.getCurrent();
    if (fs.existsSync(project.archiveDir) && !fs.lstatSync(project.archiveDir).isSymbolicLink()) for (const entry of fs.readdirSync(project.archiveDir)) {
      if (!/^T-\d+$/.test(entry)) continue;
      const zipPath = safePath(project.rootDir, `archive/${entry}/attachments.zip`);
      if (fs.existsSync(zipPath)) for (const item of new AdmZip(zipPath).getEntries()) if (/^ai-chat\//.test(item.entryName) && NAME.test(path.posix.basename(item.entryName))) bytes += item.header.size;
    }
    return { imageBytes: bytes, imageWarning: bytes >= WARNING_BYTES };
  }

  function cleanup(removedLocators = [], pruneArchived = false) {
    const retained = retainedLocators();
    const keep = new Set();
    for (const locator of retained) {
      try { keep.add(resolveImage(locator)); } catch (_) { /* Missing images are reported on preview/send. */ }
    }
    const project = projectContext.getCurrent();
    const manifest = readManifest();
    for (const [locator, relative] of Object.entries(manifest)) {
      const info = parseLocator(locator);
      if (!info || retained.has(locator)) continue;
      if (typeof relative !== 'string' || !relative.endsWith(`/${info.thread}/${info.name}`) || !/(?:^ai-chat\/images\/|\/attachments\/ai-chat\/)/.test(relative)) throw new Error('画像管理情報が不正です。');
      const checked = safePath(project.rootDir, relative);
      const wasFile = fs.existsSync(checked);
      if (wasFile) fs.unlinkSync(checked);
      if (info.taskId && (pruneArchived || removedLocators.includes(locator))) {
        const zipPath = safePath(project.rootDir, `archive/${info.taskId}/attachments.zip`);
        if (fs.existsSync(zipPath)) {
          const zip = new AdmZip(zipPath);
          const entry = `ai-chat/${info.thread}/${info.name}`;
          if (zip.getEntry(entry)) {
            zip.deleteFile(entry);
            const temporary = safePath(project.rootDir, `archive/${info.taskId}/.image-cleanup.zip`);
            zip.writeZip(temporary);
            const verified = new AdmZip(temporary);
            for (const original of zip.getEntries()) if (!original.isDirectory && !original.getData().equals(verified.readFile(original.entryName))) throw new Error('画像整理後のアーカイブ照合に失敗しました。');
            fs.renameSync(temporary, zipPath);
          }
        }
      }
      // Preserve the entry for archived originals until explicit history cleanup.
      if (!info.taskId || wasFile || pruneArchived || removedLocators.includes(locator)) delete manifest[locator];
    }
    for (const file of managedFiles()) if (file.startsWith(path.join(project.rootDir, 'ai-chat', 'image-cache') + path.sep) && !keep.has(file)) fs.unlinkSync(safePath(project.rootDir, path.relative(project.rootDir, file)));
    writeManifest(manifest);
    return usage();
  }
  return { save, remove, usage, cleanup };
}

function codexImageInput(text, images = []) {
  return images.length ? [{ type: 'text', text }, ...images.map((image) => ({ type: 'local_image', path: image.path }))] : text;
}

function restoreFailedImageReferences(aiService, threadId, runId, references) {
  const run = aiService.listRuns(threadId).find((entry) => entry.run_id === runId);
  if (!run || run.run_status === 'completed') return;
  const current = new Set(aiService.listReferences(threadId).map((ref) => ref.file_path));
  for (const reference of references) if (parseLocator(reference.file_path) && !current.has(reference.file_path)) {
    aiService.addReference(reference);
    current.add(reference.file_path);
  }
}

async function* claudeImageInput(text, images) {
  yield { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: [
    { type: 'text', text }, ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.bytes.toString('base64') } })),
  ] } };
}

module.exports = { PREFIX, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, imageFormat, validateImage, parseLocator, resolveImage, createImageStore, codexImageInput, claudeImageInput, restoreFailedImageReferences };
