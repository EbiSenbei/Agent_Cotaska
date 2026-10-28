const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../Cotaska'),req=createRequire(path.join(root,'20_app/package.json')),YAML=req('js-yaml'),matter=req('gray-matter');
const base=path.join(root,'00_mgmt/Cotaska_タスク管理ツール/tasks');
const index=YAML.load(fs.readFileSync(path.join(base,'_index.yaml'),'utf8'));
const seen=new Set();let taskCount=0;
for(const dir of fs.readdirSync(base)){
 if(!/^T-\d+$/.test(dir))continue;
 const file=path.join(base,dir,dir+'.md');if(!fs.existsSync(file))continue;
 const d=matter(fs.readFileSync(file,'utf8')).data;assert(!seen.has(d.id));seen.add(d.id);taskCount++;
}
const normal=v=>v instanceof Date?v.toISOString().replace(/T00:00:00\.000Z$/,''):v;
for(let n=832;n<=840;n++){
 const id=`T-0${n}`,file=path.join(base,id,id+'.md'),s=fs.readFileSync(file,'utf8'),d=matter(s).data;
 const item=index.tasks.filter(t=>t.id===id);assert.equal(item.length,1);
 for(const key of ['title','status','updated_at','due_date','tags','sort_order'])assert.deepEqual(normal(item[0][key]),normal(d[key]),id+' '+key);
 if(n<839){assert.equal(d.status,'todo');assert.equal(d.progress_status,'仕掛');assert.equal(d.completed_at,null);}
 if(n===839){assert.equal(d.status,'done');assert(d.completed_at);}
 if(n===840){assert.equal(d.status,'todo');assert.equal(d.progress_status,'未着');}
 for(const m of s.matchAll(/\]\(([^)]+)\)/g))if(!m[1].startsWith('http'))assert(fs.existsSync(path.resolve(path.dirname(file),m[1])),id+' '+m[1]);
}
assert(index.next_task_id>=841);
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'source-baseline.json'),'utf8'));
const expected=new Set([
 'main/aiService.js','main/claudeCodeService.js','main/codexSdkService.js','main/indexService.js','main/main.js','main/preload.js','main/taskHierarchy.js','main/taskService.js','main/watcher.js',
 'renderer/App.jsx','renderer/DetailWindowApp.jsx','renderer/components/AiChatMessage.jsx','renderer/components/AiChatPane.jsx','renderer/components/DetailPane.jsx','renderer/components/MainPane.jsx','renderer/hooks/useDebounce.js','renderer/index.jsx','renderer/lib/taskViewModel.js',
]);
const changed=[];let unchanged=0;
for(const [file,hash] of Object.entries(baseline)){
 const full=path.join(root,file),key=file.replaceAll('\\','/').replace('20_app/src/','');
 if(fs.existsSync(full)&&crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')===hash)unchanged++;
 else{assert(expected.has(key),'Unexpected source change '+key);changed.push(key);}
}
const result={validatedAt:new Date().toISOString(),taskCount,taskIndexSynced:true,linksValid:true,sourceFilesUnchanged:unchanged,expectedSourceChanges:changed};
fs.writeFileSync(path.join(__dirname,'implementation-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
