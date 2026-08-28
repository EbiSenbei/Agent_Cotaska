const fs = require("node:fs");
const path = require("node:path");
const { rcedit } = require("rcedit");

// Electron標準のASAR整合性リソースが追加される前に、
// 展開直後のElectron実行ファイルへ製品情報とアイコンを設定する。
module.exports = async function afterExtract(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const executablePath = path.join(context.appOutDir, "electron.exe");
  const iconPath = path.join(context.packager.projectDir, "setup", "launcher", "icon.ico");
  const version = context.packager.appInfo.version;

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Electron executable was not found before packaging: ${executablePath}`);
  }

  await rcedit(executablePath, {
    icon: iconPath,
    "version-string": {
      FileDescription: "Cotaska",
      ProductName: "Cotaska",
      OriginalFilename: "Cotaska.exe",
      InternalFilename: "Cotaska",
      InternalName: "Cotaska",
      CompanyName: "EbiSenbei",
    },
    "file-version": version,
    "product-version": version,
  });
};
