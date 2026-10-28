const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {performance} = require('node:perf_hooks');
const app = path.resolve(__dirname, '../../Cotaska/20_app');
const req = createRequire(path.join(app, 'package.json'));
const ctx = req('./src/main/projectContext');
const tasks = req('./src/main/taskService');
const hierarchy = req('./src/main/taskHierarchy');
const index = req('./src/main/indexService');
const sandbox = fs.mkdtempSync(path.join(__dirname, 'synthetic-'));
ctx.setCurrent(sandbox, {projectId:'T-0780-audit',name:'isolated audit'});
fs.mkdirSync(path.join(sandbox,'tasks'));
fs.writeFileSync(path.join(sandbox,'settings.yaml'), '{}');
const log = console.log;
console.log = () => {};
const results = {runtime:process.version, platform:process.platform, sandbox, generatedAt:new Date().toISOString(), measurements:[]};
function median(f, count=7) { const times=[]; for(let i=0;i<count;i++){const t=performance.now();f();times.push(performance.now()-t);} return times.sort((a,b)=>a-b)[Math.floor(times.length/2)]; }
function fixture(n) { return Array.from({length:n},(_,i)=>({id:`T-${String(i+1).padStart(4,'0')}`, title:`Synthetic task ${i}`,content:'x'.repeat(1024),parent:i?'T-0001':null,status:'todo',progress_status:'未着',priority:'normal',delete_flag:0,sort_order:i+1,tags:[],list:null,due_date:null,updated_at:'2026-10-28T00:00:00.000Z'})); }
(async()=>{
  const vmSource=fs.readFileSync(path.join(app,'src/renderer/lib/taskViewModel.js'),'utf8');
  const view=await import('data:text/javascript;base64,'+Buffer.from(vmSource).toString('base64'));
  for(const n of [100,1000,5000]){
    const rows=fixture(n),cache=Object.fromEntries(rows.map(t=>[t.id,t]));
    const original=Object.values;let calls=0,entries=0;
    Object.values=function(o){const a=original(o);calls++;entries+=a.length;return a;};
    let start=performance.now();const descendants=hierarchy.collectDescendantTasks(cache,'T-0001');let ms=performance.now()-start;
    Object.values=original;
    const rawMainMs=median(()=>hierarchy.collectDescendantTasks(cache,'T-0001'),3);
    const rendererMs=median(()=>view.collectDescendantTasks(rows,'T-0001'));
    const mapMs=median(()=>view.enrichTaskHierarchy(rows.map(view.mapFileTask)));
    const firstIndex=index.rebuildIndex(rows,['.']);
    let writes=0;const write=fs.writeFileSync;
    fs.writeFileSync=function(...args){writes++;return write.apply(this,args);};
    const unchangedIndexMs=median(()=>index.rebuildIndex(rows,['.']));
    fs.writeFileSync=write;
    results.measurements.push({n,descendantCount:descendants.length,mainDescendantInstrumentedMs:ms,mainDescendantMedianMs:rawMainMs,objectValuesCalls:calls,objectValuesEntries:entries,rendererDescendantMedianMs:rendererMs,mapAndEnrichMedianMs:mapMs,unchangedIndexMedianMs:unchangedIndexMs,unchangedIndexWrites:writes,ipcJsonBytes:Buffer.byteLength(JSON.stringify(rows))});
  }
  // Real service calls operate only on newly generated task files.
  for(const t of fixture(1000))fs.writeFileSync(path.join(sandbox,'tasks',t.id+'.md'),`---\n${req('js-yaml').dump({...t,content:undefined})}---\n${t.content}\n`);
  await tasks.openTaskService();
  const file=tasks.getTaskFilePath('T-0500');
  let start=performance.now();const applied=tasks.applyFileChange('change',file);const applyMs=performance.now()-start;
  const write=fs.writeFileSync;let writes=0;
  fs.writeFileSync=function(...args){writes++;return write.apply(this,args);};
  tasks.updateTask('T-0500',{title:tasks.getTaskById('T-0500').title});
  const sameValueUpdateWrites=writes;writes=0;
  const ids=tasks.getAllTasks().sort((a,b)=>a.sort_order-b.sort_order).map(t=>t.id);ids.unshift(ids.pop());
  start=performance.now();const reordered=tasks.reorderTasks({ordered_ids:ids});const reorderMs=performance.now()-start;
  fs.writeFileSync=write;
  results.service={applyUnchanged:applied,applyUnchangedMs:applyMs,sameValueUpdateWrites,reorderResult:reordered,reorderWrites:writes,reorderMs};
  ctx.clear();console.log=log;
  fs.writeFileSync(path.join(__dirname,'measurements.json'),JSON.stringify(results,null,2));
  log(JSON.stringify(results,null,2));
})().catch(e=>{console.log=log;console.error(e);process.exitCode=1;});
