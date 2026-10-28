const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../Cotaska/20_app/src/renderer');
const hook=fs.readFileSync(path.join(root,'hooks/useDebounce.js'),'utf8').replace(/^import .*;\r?\n/m,'').replace(/export \{ useDebounce \};/,'');
const detail=fs.readFileSync(path.join(root,'components/DetailPane.jsx'),'utf8');
const persist=detail.slice(detail.indexOf('  const persist = async (patch) => {'),detail.indexOf('  const handlePriorityChange'));
const timer={current:null};let callback,writes=[];
function render(priority){const context={useRef:()=>timer,clearTimeout:()=>{},setTimeout:f=>(callback=f,1),isInvalid:false,window:{cotaskaAPI:{tasks:{update:async p=>writes.push(p)}}},task:{id:'T-TEST',parent:null},titleText:'old title',contentText:'old content',status:'todo',progressStatus:'未着',priority,listName:'',taskTags:[],onSaved:()=>{}};vm.createContext(context);vm.runInContext(hook+'\n'+persist+'\nglobalThis.handlers={persist,debouncedSave};',context);return context.handlers;}
(async()=>{
 const old=render('normal');old.debouncedSave('new title','new content');
 await render('high').persist({priority:'high'});await callback();
 const autosave={note:'Actual hook and persist source, VM state/timer/IPC harness; no mounted React or production files.',writes};
 const app=fs.readFileSync(path.join(root,'App.jsx'),'utf8').replace(/\r\n/g,'\n');
 const chunk=app.slice(app.indexOf('  const loadTasks = useCallback'),app.indexOf('\n  useEffect(() => {\n    const handleTasksChanged'));
 const settings=[];let displayed=[];
 const noop=()=>{};
 const c={useCallback:f=>f,console,Array,Number,Boolean,window:{cotaskaAPI:{settings:{get:()=>new Promise(r=>settings.push(r))}}},onboardingSettingAppliedRef:{current:true},startupInitialViewAppliedRef:{current:true},mapFileTask:t=>t,enrichTaskHierarchy:t=>t,calcParentProgress:()=>null,sortByTaskOrder:t=>t,localDateString:()=> '2026-10-28',addDays:x=>x,dueDatePart:()=>null,isActiveDateTask:()=>false,setTasks:x=>{displayed=x},setSelectedTask:noop};
 for(const name of ['setLoading','setStartupError','setStartupProgress','setOnboardingOpen','setCompletedLimit','setActiveNav','setAllCount','setTodayCount','setTomorrowCount','setNext7DaysCount','setNoListCount','setInitialLoading'])c[name]=noop;
 vm.createContext(c);vm.runInContext(chunk+'\nglobalThis.run=loadTasks;',c);
 const first=c.run({rows:[{id:'older',status:'todo'}]});
 const second=c.run({rows:[{id:'newer',status:'todo'}]});
 settings[1]({});await second;const afterNew=displayed.map(t=>t.id);
 settings[0]({});await first;const afterOld=displayed.map(t=>t.id);
 const output={generatedAt:new Date().toISOString(),autosave,loadTasks:{note:'Actual loadTasks source, independent deferred settings IPC and minimal view-model/setter stubs.',afterNew,afterOld}};
 fs.writeFileSync(path.join(__dirname,'async-hazards.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
