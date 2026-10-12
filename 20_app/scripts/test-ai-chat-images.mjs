// Hidden Electron integration check with a deferred mock IPC bridge; no AI calls or user data.
import { createServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(appDir, "scripts/tests/ai-chat-images.fixture.jsx").replaceAll("\\", "/");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-image-ui-test-"));
const runner = path.join(tempDir, "runner.cjs");
const harnessMiddleware = (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<html><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs/${fixture}"></script></body></html>`);
};
const server = await createServer({ configFile: path.join(appDir, "vite.config.mjs"),
  plugins: [{ name: "parallel-harness", configureServer(viteServer) { viteServer.middlewares.use("/__parallel_test", harnessMiddleware); } }],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [appDir] } } });
fs.writeFileSync(runner, `
const {app,BrowserWindow}=require('electron');
const profile=require('node:path').join(__dirname,'profile');
require('node:fs').mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',(event)=>{if(event.level==='error')console.error(event.message);});
  try {
    await win.loadURL(process.argv[2]);
    for(let i=0;i<600;i++) {
      const result=await win.webContents.executeJavaScript('window.parallelResult || null');
      if(result) {console.log(JSON.stringify(result)); app.exit(result.ok?0:1); return;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Integration test timed out');
  } catch(error) {console.error(error);app.exit(1);}
});
`);
try {
  await server.listen();
  const address = server.httpServer.address();
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [runner, `http://127.0.0.1:${address.port}/__parallel_test`], {
    cwd: appDir, windowsHide: true, stdio: "inherit", env: childEnv,
  });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  if (code !== 0) process.exitCode = 1;
} finally {
  await server.close();
  // Only the directory returned by mkdtemp in the known temp root is removed.
  if (path.dirname(tempDir) !== path.resolve(os.tmpdir()) || !path.basename(tempDir).startsWith("cotaska-image-ui-test-")) throw new Error("Unsafe test cleanup path");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
