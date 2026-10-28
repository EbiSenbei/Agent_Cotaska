// Isolated Electron check: mock bridge, synthetic tree/history, no AI or project data.
import { createServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.argv.includes("--baseline");
const baselineRevision = "1ff207aedcc7656ae7dec7c9429ffec08461dd2e";
const before = baseline ? execFileSync("git", ["show", `${baselineRevision}:20_app/src/renderer/components/AiChatPane.jsx`], { cwd: appDir, encoding: "utf8" }) : null;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-workdir-ui-"));
const runner = path.join(tempDir, "runner.cjs");
const fixture = path.join(appDir, "scripts/tests/ai-workdir.fixture.jsx").replaceAll("\\", "/");
const server = await createServer({
  configFile: path.join(appDir, "vite.config.mjs"),
  plugins: [{ name: "workdir-before", enforce: "pre", load(id) {
    if (baseline && id.split("?")[0].replaceAll("\\", "/") === path.join(appDir, "src/renderer/components/AiChatPane.jsx").replaceAll("\\", "/")) return before;
  } }, { name: "workdir-test", configureServer(viteServer) {
    viteServer.middlewares.use("/__workdir_test", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true; window.workdirBaseline=${baseline};</script><script type="module" src="/@fs/${fixture}"></script></body></html>`);
    });
  } }],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [appDir] } },
});
fs.writeFileSync(runner, `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', require('node:path').join(__dirname, 'profile'));
app.whenReady().then(async () => {
  setTimeout(() => app.exit(1), 60000).unref();
  const win = new BrowserWindow({show:false, webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try {
    await win.loadURL(process.argv[2]);
    for (let i=0; i<1000; i++) {
      const result = await win.webContents.executeJavaScript('window.workdirResult || null');
      if (result) {
        result.runtime = {electron:process.versions.electron,node:process.versions.node};
        if(process.env.COTASKA_TEST_RESULT_FILE) require('node:fs').writeFileSync(process.env.COTASKA_TEST_RESULT_FILE, JSON.stringify(result,null,2));
        console.log(JSON.stringify(result)); app.exit(result.ok ? 0 : 1); return;
      }
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('workdir test timed out');
  } catch(error) {console.error(error);app.exit(1);}
});
`);
try {
  await server.listen();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [runner, `http://127.0.0.1:${server.httpServer.address().port}/__workdir_test`], {
    cwd: appDir, env, windowsHide: true, stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  if (code !== 0) process.exitCode = 1;
} finally {
  await server.close();
  const resolved = path.resolve(tempDir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("cotaska-workdir-ui-")) throw new Error("Unsafe cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
}
