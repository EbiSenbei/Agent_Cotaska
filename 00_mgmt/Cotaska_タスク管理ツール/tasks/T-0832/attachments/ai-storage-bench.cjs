const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const app=path.resolve(__dirname,'../../Cotaska/20_app');
const req=createRequire(path.join(app,'src/main/aiService.js'));
const root=fs.mkdtempSync(path.join(__dirname,'ai-storage-'));
const output={runtime:process.version,root,measurements:[]};
(async()=>{
for(const mb of [1,10,50]){
  const file=path.join(root,`${mb}MB.sqlite`); let writes=0,bytes=0;
  const module={exports:{}};
  const require=id=>{
    if(id==='fs')return {...fs,writeFileSync(file,data,...args){writes++;bytes+=data.length;return fs.writeFileSync(file,data,...args);}};
    if(id==='./projectContext')return {getCurrent:()=>({aiDatabaseFile:file})};
    if(id==='./settingsService')return {migrateLegacyResourceData(){},getSettings:()=>({settings:{}})};
    return req(id);
  };require.resolve=req.resolve;
  vm.runInNewContext(fs.readFileSync(path.join(app,'src/main/aiService.js'),'utf8'),{module,require,Buffer,console});
  const api=module.exports;await api.openAiService();const t=api.createThread({title:'generated only'});
  api.withTransaction(()=>{for(let i=0;i<mb;i++)api.addMessage({thread_id:t.thread_id,content:'x'.repeat(1024*1024)});});
  let run=api.createRun({thread_id:t.thread_id});writes=0;bytes=0;let start=performance.now();
  api.updateRun(run.run_id,{run_status:'completed'});api.addMessage({thread_id:t.thread_id,role:'assistant',content:'individual'});
  const individual={writes,bytes,ms:performance.now()-start};
  run=api.createRun({thread_id:t.thread_id});writes=0;bytes=0;start=performance.now();
  api.withTransaction(()=>{api.updateRun(run.run_id,{run_status:'completed'});api.addMessage({thread_id:t.thread_id,role:'assistant',content:'transaction'});});
  const transaction={writes,bytes,ms:performance.now()-start};
  api.updateRun(run.run_id,{run_status:'completed'});
  const afterNoOpWrites=writes;
  api.closeAiService();await api.openAiService();
  if(api.listMessages(t.thread_id).length!==mb+2)throw new Error('persistence mismatch');
  api.closeAiService();output.measurements.push({seedPayloadMiB:mb,dbBytes:fs.statSync(file).size,individual,transaction,afterNoOpWrites});
}
fs.writeFileSync(path.join(__dirname,'ai-storage-measurements.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
