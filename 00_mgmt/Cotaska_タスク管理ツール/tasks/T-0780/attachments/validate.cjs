const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'../../Cotaska'),app=path.join(repo,'20_app'),req=createRequire(path.join(app,'package.json'));
const base=path.join(repo,'00_mgmt/Cotaska_タスク管理ツール/tasks'),YAML=req('js-yaml'),matter=req('gray-matter');
const idx=YAML.load(fs.readFileSync(path.join(base,'_index.yaml'),'utf8'));
const originals=Array.from({length:11},(_,i)=>`T-${780+i}`.replace('T-','T-0'));
const followups=Array.from({length:7},(_,i)=>`T-0${832+i}`);
const all=[...originals,...followups];
const seen=new Set();
for(const dir of fs.readdirSync(base)){if(!/^T-\d+$/.test(dir))continue;const file=path.join(base,dir,dir+'.md');if(!fs.existsSync(file))continue;const d=matter(fs.readFileSync(file,'utf8')).data;assert(!seen.has(d.id),`duplicate ${d.id}`);seen.add(d.id);}
function normalized(v){return v instanceof Date?v.toISOString().replace(/T00:00:00\.000Z$/,''):v;}
for(const id of all){
 const file=path.join(base,id,id+'.md'),s=fs.readFileSync(file,'utf8'),d=matter(s).data;
 const item=idx.tasks.filter(x=>x.id===id);assert.equal(item.length,1,id+' index count');
 for(const k of ['id','title','status','priority','sort_order','updated_at','due_date','tags'])assert.deepEqual(normalized(item[0][k]),normalized(d[k]),id+' '+k);
 if(originals.includes(id)){assert.equal(d.status,'done');assert.equal(d.progress_status,'完了');assert(d.completed_at);assert(!s.includes('- [ ]'));if(id!=='T-0780')assert.equal(d.parent,'T-0780');}
 else{assert.equal(d.status,'todo');assert.equal(d.progress_status,'未着');assert.equal(d.parent,null);assert.equal(d.due_date,null);}
 for(const m of s.matchAll(/\]\(([^)]+)\)/g)){if(!m[1].startsWith('http'))assert(fs.existsSync(path.resolve(path.dirname(file),m[1])),id+' link '+m[1]);}
}
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'source-baseline.json'),'utf8'));
const crypto=require('node:crypto');for(const [file,hash]of Object.entries(manifest))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex'),hash,file+' source changed');
assert(idx.next_task_id>=839);
const output={validatedAt:new Date().toISOString(),validatedTaskIds:all,taskFilesCheckedForDuplicateIds:seen.size,sourceFilesUnchanged:Object.keys(manifest).length,indexSynced:true,linksValid:true};
fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
