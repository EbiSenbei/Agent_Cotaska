import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { readImagePreview } = createRequire(import.meta.url)("./aiImagePreview");

describe("画像ファイルのプレビュー", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-image-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it.each([
    ["PNG", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
    ["jfif", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"],
    ["bmp", "image/bmp"], ["svg", "image/svg+xml"], ["ico", "image/x-icon"], ["avif", "image/avif"],
  ])("%sをバイト列を保持した画像URLとして返す", (ext, mime) => {
    const file = path.join(dir, `画像 #1.${ext}`);
    const bytes = Buffer.from([0x89, 0xff, 0x00, 0x80]);
    fs.writeFileSync(file, bytes);
    const result = readImagePreview(file);
    expect(result.preview_type).toBe("image");
    expect(result.url.split(",")[0]).toBe(`data:${mime};base64`);
    expect(Buffer.from(result.url.split(",")[1], "base64")).toEqual(bytes);
  });

  it.each(["md", "txt", "pdf"])("%sは既存プレビューに委ねて読み込まない", (ext) => {
    expect(readImagePreview(path.join(dir, `nonexistent.${ext}`))).toBeNull();
  });

  it("画像の読み込み失敗を呼び出し元に返す", () => {
    expect(() => readImagePreview(path.join(dir, "missing.png"))).toThrow();
  });
});
