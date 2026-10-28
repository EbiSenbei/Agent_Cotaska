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
const renderPerformance = process.argv.includes("--render-performance");
const baseline = process.argv.includes("--render-baseline");
if (baseline && !renderPerformance) throw new Error('--render-baseline requires --render-performance');
const fixtureName = process.argv.includes("--context-panel") ? "ai-context-panel.fixture.jsx"
  : renderPerformance ? "render-performance.fixture.jsx"
  : process.argv.includes("--task-data") ? "task-data.fixture.jsx"
  : process.argv.includes("--preview") ? "dependency-preview.fixture.jsx"
  : process.argv.includes("--history") ? "ai-chat-history.fixture.jsx"
  : process.argv.includes("--waiting") ? "ai-chat-waiting.fixture.jsx"
  : process.argv.includes("--reasoning") ? "ai-reasoning.fixture.jsx" : "ai-chat-parallel.fixture.jsx";
const fixture = path.join(appDir, "scripts/tests", fixtureName).replaceAll("\\", "/");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-parallel-test-"));
const runner = path.join(tempDir, "runner.cjs");
const harnessMiddleware = (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<html><body><div id="root"></div><script>window.renderBaseline=${baseline};</script><script type="module" src="/@vite/client"></script><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs/${fixture}"></script></body></html>`);
};
// Controlled baseline: undo only T-0835's rendering optimizations in memory.
// Keep the current save/IPC fixes, dependencies and Markdown memo in both runs.
const baselinePlugin = {
  name: 'render-baseline', enforce: 'pre',
  load(id) {
    if (!baseline) return null;
    const file = id.split('?')[0].replaceAll('\\', '/');
    if (!file.startsWith(appDir.replaceAll('\\', '/') + '/src/renderer/components/')) return null;
    if (file.endsWith('/MainPane.jsx')) {
      return fs.readFileSync(file, 'utf8')
        .replace('return items.map(render => render());', 'return items;')
        .replace('...items.slice(startIndex, endIndex).map(render => render()),', '...items.slice(startIndex, endIndex),')
        .replace('items.push(() => renderTaskRow(task, showSep, depth, children.length, sectionMeta));', 'items.push(renderTaskRow(task, showSep, depth, children.length, sectionMeta));')
        .replace('items.push(() => renderInlineInput(task, depth + 1));', 'items.push(renderInlineInput(task, depth + 1));')
        .replace('renderVirtualizedItems(items) : items.map(render => render())', 'renderVirtualizedItems(items) : items');
    }
    if (file.endsWith('/DetailPane.jsx')) {
      return fs.readFileSync(file, 'utf8')
        .replace('const sortedTasks = useMemo(() => [...tasks].sort', 'const sortedTasks = [...tasks].sort')
        .replace('), [tasks]);', ');')
        .replace('const relatedTasksByParent = useMemo(() => sortedTasks.reduce', 'const relatedTasksByParent = sortedTasks.reduce')
        .replace('}, {}), [sortedTasks]);', '}, {});');
    }
    if (file.endsWith('/AiChatMessage.jsx')) return fs.readFileSync(file, 'utf8').replace('React.memo(AiChatMessage)', 'AiChatMessage');
  },
};
const server = await createServer({ configFile: path.join(appDir, "vite.config.mjs"),
  plugins: [baselinePlugin, { name: "parallel-harness", configureServer(viteServer) { viteServer.middlewares.use("/__parallel_test", harnessMiddleware); } }],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [appDir] } } });
fs.writeFileSync(runner, `
const {app,BrowserWindow}=require('electron');
${renderPerformance ? "app.commandLine.appendSwitch('js-flags','--expose-gc'); app.commandLine.appendSwitch('enable-precise-memory-info');" : ''}
const profile=require('node:path').join(__dirname,'profile');
require('node:fs').mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
app.whenReady().then(async()=>{
  setTimeout(()=>{console.error('Integration test watchdog timed out');app.exit(1);},${renderPerformance ? 180000 : 60000}).unref();
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:${renderPerformance} || Boolean(process.env.COTASKA_TEST_ARTIFACT_DIR)}});
  win.webContents.on('console-message',(event)=>{if(event.level==='error')console.error(event.message);});
  try {
    await win.loadURL(process.argv[2]);
    for(let i=0;i<600;i++) {
      const viewport=await win.webContents.executeJavaScript('window.testViewport || null');
      if(viewport && !viewport.done) {
        win.setContentSize(viewport.width,800);
        await win.webContents.executeJavaScript('window.testViewport.done=true');
      }
      const nativeInput=await win.webContents.executeJavaScript('window.testNativeInput || null');
      if(nativeInput && !nativeInput.done) {
        win.webContents.focus();
        for(const event of nativeInput.events) win.webContents.sendInputEvent(event);
        await win.webContents.executeJavaScript('window.testNativeInput.done = true');
      }
      const result=await win.webContents.executeJavaScript('window.parallelResult || null');
      if(result) {
        result.mode=${JSON.stringify(baseline ? 'controlled-baseline' : 'current')};
        result.runtime={electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node};
        if(process.env.COTASKA_TEST_RESULT_FILE) require('node:fs').writeFileSync(process.env.COTASKA_TEST_RESULT_FILE,JSON.stringify(result,null,2));
        if(result.ok && process.env.COTASKA_TEST_ARTIFACT_DIR) {
          const fs=require('node:fs'),path=require('node:path');
          const dir=process.env.COTASKA_TEST_ARTIFACT_DIR;
          fs.mkdirSync(dir,{recursive:true});
          await win.webContents.executeJavaScript("document.querySelector('#settings-test')?.style.setProperty('display','none')");
          win.setContentSize(520,720);
          win.webContents.debugger.attach('1.3');
          for(const theme of ['light','dark']) {
            await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
            await new Promise(resolve=>setTimeout(resolve,180));
            const colors=await win.webContents.executeJavaScript("({dark:matchMedia('(prefers-color-scheme: dark)').matches,bg:getComputedStyle(document.querySelector('.ai-reasoning-popup')).backgroundColor})");
            if(colors.dark!==(theme==='dark')) throw new Error('Theme emulation failed: '+JSON.stringify(colors));
            result[theme]=colors.bg;
            const visible=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('.ai-reasoning-popup').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()");
            if(!visible) throw new Error('Narrow popup outside viewport');
            fs.writeFileSync(path.join(dir,'reasoning-'+theme+'.png'),(await win.capturePage()).toPNG());
          }
          const duration=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.ai-reasoning-popup')).transitionDuration");
          if(duration!=='0s') throw new Error('Reduced motion transition remains active');
          win.webContents.debugger.detach();
          result.artifacts=dir;
        }
        console.log(JSON.stringify(result)); app.exit(result.ok?0:1); return;
      }
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
  if (path.dirname(tempDir) !== path.resolve(os.tmpdir()) || !path.basename(tempDir).startsWith("cotaska-parallel-test-")) throw new Error("Unsafe test cleanup path");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
