const REQUIRED_NODE_MAJOR = 24;
const REQUIRED_NODE_MINOR = 22;
const REQUIRED_NODE_PATCH = 1;

const [major, minor, patch] = process.versions.node.split(".").map(Number);
const isSupported = major === REQUIRED_NODE_MAJOR && (
  minor > REQUIRED_NODE_MINOR || (minor === REQUIRED_NODE_MINOR && patch >= REQUIRED_NODE_PATCH)
);

if (!isSupported) {
  console.error([
    `CotaskaのビルドにはNode.js 24.22.1以上の24系が必要です（現在: ${process.version}）。`,
    "20_app/.nvmrc または 20_app/setup/install/01_setup_nodejs.ps1 を使用してNode.jsを切り替えてください。",
  ].join("\n"));
  process.exit(1);
}

console.log(`Node.js ${process.version} / npm ${process.env.npm_config_user_agent?.split(" ")[0] || "unknown"}`);
