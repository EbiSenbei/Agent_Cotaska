const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

function filesIn(root) {
  const files = [];
  function walk(dir) {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('リンクはタスク資料として扱えません');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('リンクはタスク資料として扱えません');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push({ file, relative: path.relative(root, file).replace(/\\/g, '/') });
      else throw new Error('通常ファイル以外の資料は扱えません');
    }
  }
  walk(root);
  return files;
}

function copyVerified(from, to) {
  const files = filesIn(from);
  fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
  for (const { file, relative } of files) {
    if (!fs.readFileSync(file).equals(fs.readFileSync(path.join(to, relative)))) throw new Error('資料コピーの照合に失敗しました');
  }
}

function archiveTask(filePath, id, archiveDir) {
  if (typeof id !== 'string' || !/^T-\d+$/.test(id)) throw new Error('不正なタスクIDです');
  assertPlain(filePath);
  fs.mkdirSync(archiveDir, { recursive: true });
  const destination = path.join(archiveDir, id);
  if (fs.existsSync(destination)) throw new Error('同じIDのアーカイブが既にあります');
  const stage = fs.mkdtempSync(path.join(archiveDir, '.archiving-'));
  const folder = path.dirname(filePath);
  const bundled = path.basename(folder) === id;
  try {
    if (bundled) copyVerified(folder, stage);
    else fs.copyFileSync(filePath, path.join(stage, `${id}.md`), fs.constants.COPYFILE_EXCL);
    const attachments = path.join(stage, 'attachments');
    if (fs.existsSync(attachments)) {
      const entries = filesIn(attachments);
      const zipFile = path.join(stage, 'attachments.zip');
      if (fs.existsSync(zipFile)) throw new Error('attachments.zipが既にあります');
      const zip = new AdmZip();
      for (const entry of entries) zip.addFile(entry.relative, fs.readFileSync(entry.file));
      zip.writeZip(zipFile);
      const saved = new AdmZip(zipFile);
      if (saved.getEntries().filter((e) => !e.isDirectory).length !== entries.length) throw new Error('添付ZIPの件数が一致しません');
      for (const entry of entries) {
        const data = saved.readFile(entry.relative);
        if (!data || !data.equals(fs.readFileSync(entry.file))) throw new Error('添付ZIPの照合に失敗しました');
      }
      fs.rmSync(attachments, { recursive: true });
    }
    // Publish only after all copies and ZIP entries are verified.
    if (fs.existsSync(destination)) throw new Error('アーカイブ先が変更されました');
    fs.renameSync(stage, destination);
    if (bundled) fs.rmSync(folder, { recursive: true });
    else fs.unlinkSync(filePath);
    return destination;
  } catch (error) {
    // Failed staging data is retained for diagnosis; the original is untouched until publication.
    error.message += `（保存先: ${fs.existsSync(stage) ? stage : destination}）`;
    throw error;
  }
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${stem} (${i})${ext}`;
  return candidate;
}

function assertName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name === '.removed' || name.startsWith('.import-') || /[\\/:\x00-\x1f]/.test(name)) {
    throw new Error('不正な添付ファイル名です');
  }
}

function assertPlain(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('通常ファイル・フォルダだけを扱えます');
  return stat;
}

function createAttachmentService(taskService) {
  function directory(id, create = false) {
    const task = taskService.getTaskById(id);
    if (!task || task.is_invalid) throw new Error('タスクが見つかりません');
    if (create && task.delete_flag === 1) throw new Error('ゴミ箱のタスクには添付できません');
    const file = create ? taskService.ensureTaskFolder(id) : taskService.getTaskFilePath(id);
    const folder = path.dirname(file);
    assertPlain(folder, true);
    if (path.basename(folder) !== id) return null;
    const dir = path.join(folder, 'attachments');
    if (create) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dir)) assertPlain(dir, true);
    return dir;
  }
  function list(id) {
    const dir = directory(id);
    const files = [], removed = [];
    if (!dir || !fs.existsSync(dir)) return { files, removed };
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith('.import-')) {
        const stat = assertPlain(path.join(dir, entry.name));
        files.push({ name: entry.name, size: stat.size, relativePath: `attachments/${entry.name}` });
      }
    }
    const chatDir = path.join(dir, 'ai-chat');
    if (fs.existsSync(chatDir)) for (const entry of filesIn(chatDir)) {
      const name = `ai-chat/${entry.relative}`;
      files.push({ name, size: fs.statSync(entry.file).size, relativePath: `attachments/${name}`, isAiChat: true });
    }
    const removedDir = path.join(dir, '.removed');
    if (fs.existsSync(removedDir)) {
      assertPlain(removedDir, true);
      for (const token of fs.readdirSync(removedDir)) {
        if (!/^[0-9a-f-]{36}$/.test(token)) continue;
        const folder = path.join(removedDir, token);
        assertPlain(folder, true);
        for (const name of fs.readdirSync(folder)) {
          const stat = assertPlain(path.join(folder, name));
          removed.push({ token, name, size: stat.size });
        }
      }
    }
    return { files: files.sort((a, b) => a.name.localeCompare(b.name)), removed };
  }
  function add(id, sources) {
    if (!Array.isArray(sources) || !sources.length) return [];
    sources.forEach((source) => { assertPlain(source); assertName(path.basename(source)); });
    const dir = directory(id, true);
    const added = [];
    for (const source of sources) {
      const name = uniqueName(dir, path.basename(source));
      const target = path.join(dir, name);
      const temporary = path.join(dir, `.import-${crypto.randomUUID()}`);
      try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        if (!fs.readFileSync(source).equals(fs.readFileSync(temporary))) throw new Error('添付コピーの照合に失敗しました');
        // Exclusive creation prevents a file added externally during the copy from being overwritten.
        fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      added.push(name);
    }
    return added;
  }
  function file(id, name) {
    const isAiChat = typeof name === 'string' && /^ai-chat\/thread_[0-9a-f-]{36}\/clip-image_\d{8}_\d{6}_[0-9a-f]{12}\.(png|jpg|webp)$/.test(name);
    if (!isAiChat) assertName(name);
    const dir = directory(id);
    if (!dir) throw new Error('添付がありません');
    const target = path.join(dir, name);
    if (isAiChat) {
      let current = dir;
      for (const part of name.split('/').slice(0, -1)) { current = path.join(current, part); assertPlain(current, true); }
    }
    assertPlain(target);
    return target;
  }
  function saveImage(id, bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Image must be between 1 byte and 20MB');
    const dir = directory(id, true);
    const name = uniqueName(dir, `image-${Date.now()}.png`);
    fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
    return { name, relativePath: `attachments/${name}` };
  }
  function readImage(id, reference) {
    if (typeof reference !== 'string') throw new Error('Invalid image reference');
    const relative = decodeURIComponent(reference);
    if (!relative || /[\\:\x00-\x1f]/.test(relative) || path.isAbsolute(relative)) throw new Error('Use a relative image path');
    const base = taskService.getTaskBaseDir(id);
    const target = path.resolve(base, relative);
    const resolved = path.relative(base, target);
    if (resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('Images outside the task cannot be displayed');
    assertPlain(base, true);
    const parts = resolved.split(path.sep);
    let current = base;
    parts.forEach((part, index) => { current = path.join(current, part); assertPlain(current, index < parts.length - 1); });
    if (fs.statSync(target).size > 20 * 1024 * 1024) throw new Error('Image exceeds 20MB');
    const image = require('./aiImagePreview').readImagePreview(target);
    if (!image) throw new Error('Unsupported image format');
    return image;
  }
  function remove(id, name) {
    if (String(name).startsWith('ai-chat/')) throw new Error('AIチャット画像はチャットの添付解除・履歴整理から削除してください。');
    if (taskService.getTaskById(id)?.delete_flag === 1) throw new Error('ゴミ箱の添付は変更できません');
    const source = file(id, name);
    const base = path.join(path.dirname(source), '.removed');
    if (fs.existsSync(base)) assertPlain(base, true);
    const token = crypto.randomUUID();
    const target = path.join(base, token);
    fs.mkdirSync(target, { recursive: true });
    fs.renameSync(source, path.join(target, name));
    return token;
  }
  function restore(id, token) {
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) throw new Error('不正な復元IDです');
    const dir = directory(id, true);
    const base = path.join(dir, '.removed');
    assertPlain(base, true);
    const folder = path.join(base, token);
    assertPlain(folder, true);
    const names = fs.readdirSync(folder);
    if (names.length !== 1) throw new Error('復元資料を特定できません');
    const original = names[0];
    assertName(original);
    assertPlain(path.join(folder, original));
    const name = uniqueName(dir, original);
    fs.renameSync(path.join(folder, original), path.join(dir, name));
    fs.rmdirSync(folder);
    return name;
  }
  return { list, add, file, remove, restore, saveImage, readImage };
}

module.exports = { archiveTask, copyVerified, createAttachmentService };
