// AIチャットの参照ファイルコンテキスト構築（プロバイダ非依存の共通ロジック）。
// codexSdkService / claudeCodeService の双方から利用する。
const path = require("path");
const fs = require("fs");
const aiService = require("./aiService");
const clipboardImages = require('./aiClipboardImages');

const REFERENCE_SEND_MODES = new Set(["always", "manual", "skip-in-speed"]);

function normalizeReferenceSendMode(value, fallback = "always") {
  const mode = String(value || fallback).trim();
  return REFERENCE_SEND_MODES.has(mode) ? mode : fallback;
}

function ensurePathInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, targetPath || "");
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function resolveReferenceFilePath(workdir, referencePath) {
  if (!referencePath) return null;
  if (clipboardImages.parseLocator(referencePath)) return clipboardImages.resolveImage(referencePath);
  if (path.isAbsolute(referencePath)) return path.resolve(referencePath);
  return ensurePathInside(workdir, referencePath);
}

function formatReferencePath(workdir, filePath) {
  const relative = path.relative(path.resolve(workdir), filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return filePath;
}

// 参照ファイルの内容を集約し、プロンプト前置き文字列を構築する。
// settings: aiChat 設定（referenceSendMode / maxReferenceFiles / maxReferenceChars を参照）
// options: { performanceMode, referenceSendMode(force/skip/明示値) }
// isSpeedMode: 高速モードか（プロバイダごとに判定して渡す）
function buildReferenceContext(threadId, workdir, settings, options = {}) {
  const isSpeedMode = options.isSpeedMode === true;
  const configuredMode = normalizeReferenceSendMode(settings.referenceSendMode);
  const requestedMode = options.referenceSendMode || options.reference_send_mode;
  const referenceSendMode = requestedMode === "force"
    ? "always"
    : requestedMode === "skip"
      ? "manual"
      : normalizeReferenceSendMode(requestedMode, configuredMode);
  const shouldSendReferences = referenceSendMode === "always"
    || (referenceSendMode === "skip-in-speed" && !isSpeedMode);
  if (!shouldSendReferences) {
    return {
      promptPrefix: "",
      usedCount: 0,
      totalChars: 0,
      skipped: [],
      sendMode: referenceSendMode,
      sent: false,
      skippedReason: referenceSendMode === "manual" ? "manual" : "speed",
    };
  }
  const maxFiles = Number(settings.maxReferenceFiles || 10);
  const maxChars = Number(settings.maxReferenceChars || 100000);
  const selectedRefs = aiService
    .listReferences(threadId)
    .filter((ref) => ref.ref_type === "file" && ref.file_path)
    .filter((ref) => !Array.isArray(options.referenceIds) || options.referenceIds.includes(ref.reference_id));
  if (selectedRefs.slice(Math.max(0, maxFiles)).some((ref) => clipboardImages.parseLocator(ref.file_path))) throw new Error('画像の参照件数上限を超えています。');
  const refs = selectedRefs.slice(0, Math.max(0, maxFiles));
  const chunks = [];
  const images = [];
  let totalChars = 0;
  const skipped = [];

  refs.forEach((ref) => {
    const filePath = resolveReferenceFilePath(workdir, ref.file_path);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      if (/\.(png|jpe?g|webp)$/i.test(filePath || ref.file_path)) throw new Error('送信する画像が見つかりません。添付を確認してください。');
      skipped.push(ref.label || ref.file_path);
      return;
    }
    if (/\.(gif|bmp|ico|avif)$/i.test(filePath)) throw new Error('AI画像入力はPNG・JPEG・WebPに対応しています。');
    if (/\.(png|jpe?g|webp)$/i.test(filePath)) {
      if (fs.statSync(filePath).size > clipboardImages.MAX_IMAGE_BYTES) throw new Error('画像は1枚10MiB以内にしてください。');
      const bytes = fs.readFileSync(filePath);
      const format = clipboardImages.validateImage(bytes);
      images.push({ path: filePath, bytes, mime: format.mime });
      if (images.reduce((sum, image) => sum + image.bytes.length, 0) > clipboardImages.MAX_TOTAL_BYTES) throw new Error('画像の合計は20MiB以内にしてください。');
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const remaining = maxChars - totalChars;
    if (remaining <= 0) {
      skipped.push(ref.label || ref.file_path);
      return;
    }
    const sliced = content.slice(0, remaining);
    totalChars += sliced.length;
    chunks.push([
      `### ${ref.label || path.basename(filePath)}`,
      `path: ${formatReferencePath(workdir, filePath)}`,
      "```",
      sliced,
      "```",
    ].join("\n"));
    if (content.length > sliced.length) {
      skipped.push(`${ref.label || ref.file_path} (truncated)`);
    }
  });

  if (chunks.length === 0 && images.length === 0) {
    return { promptPrefix: "", usedCount: 0, totalChars, skipped, sendMode: referenceSendMode, sent: false, skippedReason: "empty" };
  }
  const promptPrefix = [
    "以下はCotaskaで選択された参照ファイルです。回答時の根拠として使ってください。",
    ...chunks,
    skipped.length > 0 ? `参照上限により省略または切り詰めたファイル: ${skipped.join(", ")}` : "",
    "",
  ].filter(Boolean).join("\n\n");
  return { promptPrefix: chunks.length ? promptPrefix : '', images, usedCount: chunks.length + images.length, totalChars, skipped, sendMode: referenceSendMode, sent: true, skippedReason: null };
}

module.exports = {
  normalizeReferenceSendMode,
  ensurePathInside,
  resolveReferenceFilePath,
  formatReferencePath,
  buildReferenceContext,
};
