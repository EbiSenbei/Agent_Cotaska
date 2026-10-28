// Read-only scan of the explicit directory argument; no application/AI startup.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const { listWorkdirTree } = require("../src/main/aiWorkdirTree");
const root = process.argv[2];
if (!root) throw new Error("Pass the directory to scan (read only)");
const baselineRevision = "1ff207aedcc7656ae7dec7c9429ffec08461dd2e";
const beforeSource = execFileSync("git", ["show", `${baselineRevision}:20_app/src/main/main.js`], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
const begin = beforeSource.indexOf("const AI_TREE_EXCLUDED_NAMES");
const end = beforeSource.indexOf("function getAiWorkdir", begin);
if (begin < 0 || end < 0) throw new Error("Baseline anchors missing");
const context = { fs, path };
vm.createContext(context);
vm.runInContext(beforeSource.slice(begin, end) + ";this.scan=listWorkdirTree;", context);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function measure(name, scan) {
  let last = performance.now(), maxGap = 0, ticks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last); last = now; ticks++;
  }, 5);
  await delay(20);
  const ticksBefore = ticks, start = performance.now();
  const result = await scan(root);
  const elapsedMs = performance.now() - start, ticksDuringScan = ticks - ticksBefore;
  await delay(20);
  clearInterval(timer);
  const json = JSON.stringify(result);
  return { name, rows: result.rows.length, jsonBytes: Buffer.byteLength(json),
    sha256: createHash("sha256").update(json).digest("hex"),
    elapsedMs, maxEventLoopGapMs: maxGap, ticksDuringScan };
}
(async () => {
  const samples = [await measure("before", context.scan), await measure("after", listWorkdirTree)];
  const result = { root: path.resolve(root), node: process.versions.node, samples };
  if (process.env.COTASKA_TEST_RESULT_FILE) fs.writeFileSync(process.env.COTASKA_TEST_RESULT_FILE, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
