const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');

const MAX_BYTES = 50 * 1024 * 1024;
function findLibreOffice() {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean).map((root) => path.join(root, 'LibreOffice', 'program', 'soffice.exe'))
    .find((file) => fs.existsSync(file));
}
function convertWithLibreOffice(input, output, profile, executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--convert-to', 'pdf:impress_pdf_Export', '--outdir', output, input], { windowsHide: true, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Stop only this conversion's process tree, including soffice.bin on Windows.
      if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill());
      else child.kill('SIGKILL');
    }, 60000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('LibreOfficeを起動できません。外部アプリで開いてください。')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut || code !== 0) reject(new Error('PowerPointの変換に失敗しました（60秒の制限、破損・保護付き資料など）。外部アプリで開いてください。'));
      else resolve();
    });
  });
}
function readPdf(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) throw new Error('プレビューは50MB以下の資料に対応しています。外部アプリで開いてください。');
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDFを読み込めません。破損または未対応の資料です。');
  return { bytes: new Uint8Array(bytes) };
}
function createDocumentPreviewService({ attachments, findConverter = findLibreOffice, convert = convertWithLibreOffice }) {
  // Serialize conversions to bound memory and avoid concurrent office processes.
  let queue = Promise.resolve();
  async function preview(id, name) {
    const file = attachments.file(id, name);
    const ext = path.extname(name).toLowerCase();
    if (!['.pdf', '.ppt', '.pptx'].includes(ext)) throw new Error('PDF・PowerPointのみプレビューできます。');
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('プレビューは50MB以下の資料に対応しています。');
    if (ext === '.pdf') return readPdf(file);
    const executable = findConverter();
    if (!executable) throw new Error('PowerPointのプレビューにはLibreOfficeの導入が必要です。Officeは不要です。外部アプリで開くこともできます。');
    const run = async () => {
      // Revalidate after waiting; removed attachments must never be served.
      const source = attachments.file(id, name);
      if (source !== file) throw new Error('プロジェクトが変更されました。再度開いてください。');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotaska-preview-'));
      try {
        const input = path.join(dir, `document${ext}`);
        const profile = path.join(dir, 'profile');
        fs.mkdirSync(path.join(profile, 'user'), { recursive: true });
        fs.writeFileSync(path.join(profile, 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
        fs.copyFileSync(source, input, fs.constants.COPYFILE_EXCL);
        if (fs.statSync(input).size > MAX_BYTES) throw new Error('プレビューは50MB以下の資料に対応しています。');
        await convert(input, dir, profile, executable);
        attachments.file(id, name);
        const pdf = path.join(dir, 'document.pdf');
        if (!fs.existsSync(pdf)) throw new Error('スライドを変換できません。破損・保護付き資料は外部アプリで開いてください。');
        return readPdf(pdf);
      } finally {
        // Only our randomly created temporary directory is removed; task data is untouched.
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };
    const pending = queue.then(run, run);
    queue = pending.catch(() => {});
    return pending;
  }
  return { preview };
}
module.exports = { createDocumentPreviewService, readPdf, MAX_BYTES };
