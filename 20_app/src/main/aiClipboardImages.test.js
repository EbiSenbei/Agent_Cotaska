import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const projectContext = require('./projectContext');
const images = require('./aiClipboardImages');
const { archiveTask, createAttachmentService } = require('./taskFileBundle');
const AdmZip = require('adm-zip');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=', 'base64');
const threadId = 'thread_12345678-1234-1234-1234-123456789abc';
let root, previousProject, thread, refs, messages, runs, service, tasks, store;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-image-test-'));
  previousProject = projectContext.getCurrentOrNull();
  projectContext.setCurrent(root, { projectId: 'test', name: 'test' });
  thread = { thread_id: threadId, thread_status: 'active', primary_task_id: null };
  refs = []; messages = []; runs = [];
  service = {
    getThread: () => thread,
    listThreads: () => thread ? [thread] : [],
    listReferences: () => refs,
    listMessages: () => messages,
    listRuns: () => runs,
    addReference: (input) => { const ref = { ...input, reference_id: input.reference_id || `ref-${refs.length}` }; refs.push(ref); return ref; },
    removeReference: (id) => { refs = refs.filter((ref) => ref.reference_id !== id); return { ok: true }; },
  };
  tasks = {
    getTaskById: (id) => ({ id, delete_flag: 0 }),
    getTaskFilePath: (id) => path.join(root, 'tasks', id, `${id}.md`),
    getTaskBaseDir: (id) => path.join(root, 'tasks', id),
    ensureTaskFolder: (id) => { const file = tasks.getTaskFilePath(id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'task'); return file; },
  };
  store = images.createImageStore(service, tasks);
});
afterEach(() => {
  if (previousProject) projectContext.setCurrent(previousProject.rootDir, previousProject.manifest); else projectContext.clear();
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('cotaska-image-test-')) throw new Error('Unsafe cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
const paste = () => store.save(threadId, [{ base64: png.toString('base64') }]);

describe('チャットのクリップボード画像', () => {
  it('タスクなしの保存先・命名・再読込と画像送信ブロック', async () => {
    const result = paste();
    const ref = result.references[0];
    expect(ref.label).toMatch(/^clip-image_\d{8}_\d{6}_[0-9a-f]{12}\.png$/);
    const file = images.resolveImage(ref.file_path);
    expect(file).toBe(path.join(root, 'ai-chat', 'images', threadId, ref.label));
    expect(fs.readFileSync(file)).toEqual(png);
    expect(images.createImageStore(service, tasks).usage().imageBytes).toBe(png.length);
    expect(images.codexImageInput('説明', [{ path: file }])).toEqual([{ type: 'text', text: '説明' }, { type: 'local_image', path: file }]);
    for await (const input of images.claudeImageInput('説明', [{ bytes: png, mime: 'image/png' }])) {
      expect(input.message.content[1].source.data).toBe(png.toString('base64'));
      expect(input.message.content[1].source.media_type).toBe('image/png');
    }
  });
  it('タスク添付に表示し、関連タスク変更とアーカイブ後も元画像を参照する', () => {
    thread.primary_task_id = 'T-0742';
    const ref = paste().references[0];
    const file = images.resolveImage(ref.file_path);
    const attachments = createAttachmentService(tasks);
    const row = attachments.list('T-0742').files[0];
    expect(row.isAiChat).toBe(true);
    expect(attachments.file('T-0742', row.name)).toBe(file);
    expect(() => attachments.remove('T-0742', row.name)).toThrow();
    thread.primary_task_id = 'T-0743';
    expect(images.resolveImage(ref.file_path)).toBe(file);
    messages.push({ attachments: [{ filePath: ref.file_path }] }); refs = [];
    const archived = archiveTask(tasks.getTaskFilePath('T-0742'), 'T-0742', path.join(root, 'archive'));
    expect(fs.existsSync(path.join(archived, 'attachments.zip'))).toBe(true);
    expect(fs.readFileSync(images.resolveImage(ref.file_path))).toEqual(png);
    store.cleanup();
    expect(fs.readFileSync(images.resolveImage(ref.file_path))).toEqual(png);
  });
  it('未送信の解除は削除し、履歴の参照を持つ画像は保持する', () => {
    const first = paste().references[0];
    store.remove(first.reference_id);
    expect(() => images.resolveImage(first.file_path)).toThrow();
    const second = paste().references[0];
    messages.push({ attachments: [{ filePath: second.file_path }] });
    store.remove(second.reference_id);
    store.cleanup();
    expect(fs.readFileSync(images.resolveImage(second.file_path))).toEqual(png);
  });
  it('サブフォルダのタスク保存先を解決しプロジェクト移動後も参照する', () => {
    tasks.getTaskBaseDir = (id) => path.join(root, 'tasks', 'group', id);
    tasks.getTaskFilePath = (id) => path.join(tasks.getTaskBaseDir(id), `${id}.md`);
    thread.primary_task_id = 'T-0742';
    const ref = paste().references[0];
    expect(images.resolveImage(ref.file_path)).toContain(path.join('tasks', 'group', 'T-0742'));
    const moved = `${root}-moved`;
    fs.renameSync(root, moved); root = moved;
    projectContext.setCurrent(root, { projectId: 'test', name: 'test' });
    expect(fs.readFileSync(images.resolveImage(ref.file_path))).toEqual(png);
  });
  it('重複貼り付けは別名、起動時整理は通常資料と複製タスクの画像を保持', () => {
    thread.primary_task_id = 'T-0742';
    const first = paste().references[0];
    const second = paste().references[0];
    expect(first.label).not.toBe(second.label);
    const source = images.resolveImage(first.file_path);
    const duplicate = path.join(root, 'tasks', 'T-0743', 'attachments', 'ai-chat', threadId, first.label);
    fs.mkdirSync(path.dirname(duplicate), { recursive: true }); fs.copyFileSync(source, duplicate);
    refs = [];
    store.cleanup();
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(duplicate)).toEqual(png);
  });
  it('形式・件数・サイズ・処理中・不正参照を拒否し、既存添付を保持', () => {
    const first = paste().references[0];
    expect(() => store.save(threadId, [{ base64: Buffer.from('text').toString('base64') }])).toThrow();
    expect(() => store.save(threadId, [{ base64: png.toString('base64') }], 1)).toThrow();
    expect(() => images.validateImage(Buffer.alloc(images.MAX_IMAGE_BYTES + 1))).toThrow();
    runs.push({ run_status: 'running' }); expect(() => paste()).toThrow(); runs = [];
    for (const ref of ['cotaska-image:chat/../../settings.yaml', `cotaska-image:task/T-0742/${threadId}/../x.png`]) expect(() => images.resolveImage(ref)).toThrow();
    expect(fs.readFileSync(images.resolveImage(first.file_path))).toEqual(png);
  });
  it('合計20MiB超過は一括拒否し、既存画像を増やさない', () => {
    paste();
    const padded = Buffer.alloc(8 * 1024 * 1024); png.copy(padded);
    expect(() => store.save(threadId, Array.from({ length: 3 }, () => ({ base64: padded.toString('base64') })))).toThrow('20MiB');
    expect(refs).toHaveLength(1);
  });
  it('前回終了時に残ったDBのrunning履歴で添付をロックしない', () => {
    runs.push({ run_status: 'running' });
    const runtimeStore = images.createImageStore(service, tasks, () => false);
    expect(runtimeStore.save(threadId, [{ base64: png.toString('base64') }]).ok).toBe(true);
  });
  it('画像をUTF-8で読まず、設定・選択IDと参照件数上限を守る', () => {
    paste();
    const actualService = require('./aiService');
    const original = actualService.listReferences;
    actualService.listReferences = () => refs;
    try {
      const build = require('./aiChatReferences').buildReferenceContext;
      const context = build(threadId, root, {});
      expect(context.images[0].bytes).toEqual(png);
      expect(context.promptPrefix).toBe('');
      expect(context.usedCount).toBe(1);
      expect(context.imageSendNotice).toBeUndefined();
      expect(build(threadId, root, { referenceSendMode: 'manual' }, { referenceSendMode: 'skip', isSpeedMode: true }).images).toHaveLength(1);
      expect(build(threadId, root, {}, { referenceIds: [] }).usedCount).toBe(0);
      refs.unshift({ ref_type: 'file', file_path: 'a.txt' });
      expect(() => build(threadId, root, { maxReferenceFiles: 1 })).toThrow('件数上限');
    } finally { actualService.listReferences = original; }
  });
  it('管理先へのジャンクションを拒否し、リンク先を変更しない', () => {
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, 'ai-chat'));
    fs.symlinkSync(outside, path.join(root, 'ai-chat', 'images'), 'junction');
    expect(() => paste()).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it('履歴削除後のZIP画像整理は他の資料を保持しキャッシュも削除', () => {
    thread.primary_task_id = 'T-0742';
    const ref = paste().references[0];
    fs.writeFileSync(path.join(tasks.getTaskBaseDir('T-0742'), 'attachments', '資料.txt'), '保持');
    messages.push({ attachments: [{ filePath: ref.file_path }] }); refs = [];
    const archive = archiveTask(tasks.getTaskFilePath('T-0742'), 'T-0742', path.join(root, 'archive'));
    images.resolveImage(ref.file_path);
    messages = []; thread = null;
    store.cleanup([ref.file_path]);
    expect(new AdmZip(path.join(archive, 'attachments.zip')).readAsText('資料.txt')).toBe('保持');
    expect(() => images.resolveImage(ref.file_path)).toThrow();
    expect(store.usage().imageBytes).toBe(0);
  });
  it('失敗した画像送信は再添付し成功時は消費、同じ参照は増殖しない', () => {
    const ref = paste().references[0]; refs = [];
    runs.push({ run_id: 'run', run_status: 'failed' });
    images.restoreFailedImageReferences(service, threadId, 'run', [ref]);
    images.restoreFailedImageReferences(service, threadId, 'run', [ref]);
    expect(refs).toHaveLength(1);
    refs = []; runs[0].run_status = 'completed';
    images.restoreFailedImageReferences(service, threadId, 'run', [ref]); expect(refs).toHaveLength(0);
  });
  it('プロジェクトバックアップに画像本体と管理情報を含める', () => {
    const ref = paste().references[0];
    const backup = require('./backupService').createBackupService({ appVersion: 'test', appDisplayName: 'test' });
    expect(backup.createBackup(path.join(root, 'ai-chat', 'images', 'backups')).ok).toBe(false);
    const result = backup.createBackup(path.join(root, 'backups'));
    expect(result.ok).toBe(true);
    const zip = new AdmZip(result.backupPath);
    expect(zip.readFile(`ai-chat/images/${threadId}/${ref.label}`)).toEqual(png);
    expect(JSON.parse(zip.readAsText('ai-chat/image-manifest.json'))[ref.file_path]).toBe(`ai-chat/images/${threadId}/${ref.label}`);
  });
});
