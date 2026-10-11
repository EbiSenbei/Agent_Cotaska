const fs = require("fs");
const path = require("path");

const IMAGE_MIME_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".jfif", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
  [".bmp", "image/bmp"], [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"], [".avif", "image/avif"],
]);

function readImagePreview(filePath) {
  const mimeType = IMAGE_MIME_TYPES.get(path.extname(filePath).toLowerCase());
  if (!mimeType) return null;
  // Development renderer cannot load file:// images; use the same URL in both builds.
  return { preview_type: "image", url: `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}` };
}

module.exports = { readImagePreview };
