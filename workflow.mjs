import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { profiles as builtins } from './orchestration.mjs';
import { selectedExtensions } from './child-extensions.mjs';
import { readProjectConfig } from './project-config.mjs';
import { taskGraph } from './task-scheduler.mjs';
const readonly=['read','grep','find','ls'],all=[...readonly,'bash','edit','write'];
function configuration(file) {if(statSync(file).size>262144)throw new Error('Mesh configuration exceeds 256 KiB');return JSON.parse(readFileSync(file,'utf8'))}
export function toolCeiling(activeTools) { const tools=new Set(activeTools);if(tools.has('bash'))for(const name of ['grep','find','ls'])tools.add(name);return tools; }
export function text(value,label,max=16000) { if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw new Error(`Invalid ${label}`);return value; }
export function integer(value,fallback,min,max,label) { const n=value??fallback;if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Invalid ${label}: expected ${min}–${max}`);return n; }
export function name(value) { if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(value))throw new Error('Invalid profile/workflow name');return value; }
export function loadProfiles(agentDir,cwd) {
 const values=Object.fromEntries(Object.entries(builtins).map(([key,p])=>[key,{...p,tools:p.write?all:readonly,source:'builtin'}]));
 for(const [folder,source] of [[join(agentDir,'mesh'),'user'],[join(cwd,'.pi','mesh'),'project']]) {
  const file=join(folder,'profiles.json');
  const embedded=source==='project'?readProjectConfig(cwd).value.profiles||{}:{};
  const configured=existsSync(file)?configuration(file):{};if(!configured||Array.isArray(configured)||typeof configured!=='object')throw new Error('profiles.json must be an object');
  const items={...embedded,...configured};
  for(const [key,p] of Object.entries(items)) {
   name(key);if(!p||typeof p!=='object')throw new Error('Invalid profile');
   const base=values[key]||{write:false,prompt:'',tools:readonly},write=p.write??base.write;
   if(typeof write!=='boolean')throw new Error('Profile write must be boolean');
   const tools=p.tools??(write?all:readonly);if(!Array.isArray(tools)||tools.some(t=>!(write?all:readonly).includes(t)))throw new Error('Profile tools exceed its write permission');
   values[key]={write,prompt:text(p.prompt??base.prompt,'profile prompt'),tools:[...new Set(tools)],model:p.model?text(p.model,'profile model',300):undefined,source};
  }
 }
 return values;
}
export function savedWorkflows(agentDir,cwd) {
 const result={};for(const folder of [join(agentDir,'mesh','workflows'),join(cwd,'.pi','mesh','workflows')]) {
  if(!existsSync(folder))continue;
  const files=readdirSync(folder).filter(f=>/^[a-z][a-z0-9_-]{0,47}\.json$/.test(f));if(files.length>64)throw new Error('At most 64 saved workflows per scope');
  for(const file of files)result[file.slice(0,-5)]=configuration(join(folder,file));
 }return result;
}
export function validateGates(gates=[]) {
 if(!Array.isArray(gates)||gates.length>8)throw new Error('At most eight acceptance gates');
 return gates.map(g=>{
  if(g.type==='command')return {type:'command',command:text(g.command,'command',2000),args:(()=>{if(!Array.isArray(g.args)||g.args.length>64)throw new Error('Command args must be an array');return g.args.map(a=>{if(typeof a!=='string'||a.length>4000||a.includes('\0'))throw new Error('Invalid command argument');return a})})(),timeoutMs:integer(g.timeoutMs,60000,100,300000,'gate timeout')};
  if(g.type==='json') { const required=g.required||[],equals=g.equals||{};if(!Array.isArray(required)||required.some(k=>typeof k!=='string'||k.length>80)||!equals||Array.isArray(equals)||typeof equals!=='object'||Object.values(equals).some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw new Error('Invalid JSON gate');const types=g.types||{};if(!types||Array.isArray(types)||typeof types!=='object'||Object.values(types).some(v=>!['string','number','boolean','array','object','null'].includes(v)))throw new Error('Invalid JSON field types');return {type:'json',required,equals,types}; }
  throw new Error('Gate type must be command or json');
 });
}
export function compileWorkflow(input,profiles,{activeTools,currentModel,availableModels=[currentModel],agentDir}={}) {
 if(!input||typeof input!=='object')throw new Error('Workflow must be an object');
 if(Buffer.byteLength(JSON.stringify(input))>262144)throw new Error('Workflow definition exceeds 256 KiB');
 if(input.mode!==undefined&&!['sequence','parallel'].includes(input.mode))throw new Error('Invalid workflow mode');
 if(input.context!==undefined&&!['fresh','fork'].includes(input.context))throw new Error('Invalid context mode');
 if(input.untilComplete!==undefined&&typeof input.untilComplete!=='boolean')throw new Error('untilComplete must be boolean');
 const untilComplete=input.untilComplete===true;
 const ceiling=toolCeiling(activeTools);
 const tasks=input.tasks,rawStages=input.stages||(input.mode==='parallel'?[{tasks,parallel:true}]:(tasks||[]).map(task=>({tasks:[task]})));
 if(!Array.isArray(rawStages)||!rawStages.length||rawStages.length>16)throw new Error('Workflow requires 1–16 stages');
 let count=0;const ids=new Set(),stages=[];
 for(const [i,stage] of rawStages.entries()) {
  if(!Array.isArray(stage.tasks)||!stage.tasks.length||stage.tasks.length>64)throw new Error('Stage requires 1–64 tasks');
  const earlier=new Set(ids);
  const mapped=stage.tasks.map((t,j)=>{
   const profile=t.profile||'scout',p=Object.hasOwn(profiles,profile)?profiles[profile]:null;if(!p)throw new Error(`Unknown profile ${profile}`);
   const id=t.id||`step-${i+1}-${j+1}`;name(id);if(ids.has(id))throw new Error('Duplicate step ID');ids.add(id);
   const model=t.model||p.model||currentModel;if(!availableModels.includes(model))throw new Error(`Model is unavailable: ${model}`);
   const refinement=t.refinement?text(t.refinement,'refinement',4000):'';
   const extensions=t.extensions===undefined?[]:agentDir?selectedExtensions(agentDir,t.extensions):(()=>{throw new Error('Agent directory required for installed child extensions')})();
   const extensionTools=t.extensionTools??[];
   if(!Array.isArray(extensionTools)||extensionTools.length>16||extensionTools.some(tool=>typeof tool!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(tool)||[...all,'powershell'].includes(tool)||tool.startsWith('agent_mesh_'))||new Set(extensionTools).size!==extensionTools.length||extensionTools.length&&!extensions.length)throw new Error('Explicit extension tools require a selected installed child extension');
   if(t.boardTaskId!==undefined&&(typeof t.boardTaskId!=='string'||!/^[a-f0-9-]{36}$/.test(t.boardTaskId)))throw Error('Invalid project board task identifier');
   const dependsOn=t.dependsOn;
   if(dependsOn!==undefined&&(!Array.isArray(dependsOn)||dependsOn.length>64||dependsOn.some(dep=>typeof dep!=='string')))throw Error('Invalid task dependencies');
   count++;return {id,...(t.boardTaskId?{boardTaskId:t.boardTaskId}:{}),...(dependsOn===undefined?{}:{dependsOn:[...new Set(dependsOn)]}),lane:t.lane?name(t.lane):(stage.parallel?id:'main'),profile,task:text(t.task,'task'),prompt:p.prompt+(refinement?`\nTask refinement: ${refinement}`:''),write:p.write,tools:p.tools.filter(tool=>ceiling.has(tool)),model,extensions,extensionTools,acceptance:validateGates(t.acceptance)};
  });
  // Conflicting lanes are queued by the dependency/resource scheduler, never run together.
  let when;
  if(stage.when) { if(!earlier.has(stage.when.step)||typeof stage.when.field!=='string'||stage.when.field.length>80||!Object.hasOwn(stage.when,'equals')||!['string','number','boolean'].includes(typeof stage.when.equals))throw new Error('Conditions must reference a completed earlier step and a primitive JSON field');when={step:stage.when.step,field:stage.when.field,equals:stage.when.equals}; }
  const retries=integer(stage.retries,0,0,2,'retries');count+=mapped.length*retries;
  stages.push({tasks:mapped,parallel:stage.parallel===true,retries,when});
  if(input.watchdog===true&&mapped.some(t=>t.write)) {
   const p=profiles.auditor;if(!p||p.write)throw new Error('Watchdog requires a read-only auditor');
   const id=`watch-${i+1}`;if(ids.has(id))throw new Error('Watchdog ID collision');ids.add(id);count++;
   stages.push({tasks:[{id,profile:'auditor',task:'Audit the preceding stage against its assigned scope and reported checks. Inspect code/evidence. Return only JSON {"verdict":"pass"|"fail","findings":[...]}. Do not edit or run another agent.',prompt:p.prompt,write:false,tools:p.tools.filter(t=>ceiling.has(t)),model:currentModel,acceptance:[{type:'json',required:['verdict','findings'],equals:{verdict:'pass'},types:{verdict:'string',findings:'array'}}]}],parallel:false,retries:0});
  }
 }
 const isolation=input.isolation||'worktree';if(!['worktree','shared'].includes(isolation))throw new Error('Invalid isolation');
 // Shared writers are serialized with all readers of the same shared directory.
 const byId=new Map(taskGraph({stages}).map(t=>[t.id,t])),visited=new Set();
 const visit=(id,path=new Set())=>{if(path.has(id))throw Error('Task dependency cycle');if(visited.has(id))return;const task=byId.get(id);if(!task)throw Error(`Unknown dependency ${id}`);for(const dep of task.dependsOn||[])visit(dep,new Set([...path,id]));visited.add(id)};
 for(const id of byId.keys())visit(id);
 const schedule=input.schedule?{at:Date.parse(input.schedule.at),everyMs:integer(input.schedule.everyMs,0,0,86400000,'interval'),maxRuns:integer(input.schedule.maxRuns,1,1,16,'schedule runs')}:null;
 if(schedule&&(!Number.isFinite(schedule.at)||schedule.at<Date.now()-60000||schedule.at>Date.now()+7*86400000||(schedule.maxRuns>1&&schedule.everyMs<60000)))throw new Error('Schedule must start within seven days; repeats need at least 60 seconds');
 if(schedule&&stages.some(s=>s.tasks.some(t=>t.boardTaskId)))throw new Error('A bound board card is single-run work and cannot be scheduled');
 const maxCalls=integer(input.maxCalls,64,1,64,'spawn budget');if(count*(schedule?.maxRuns||1)>maxCalls)throw new Error('Plan exceeds child-spawn budget');
 const maxCost=input.maxCost===null&&untilComplete?null:(input.maxCost??10);if(maxCost!==null&&(typeof maxCost!=='number'||!Number.isFinite(maxCost)||maxCost<=0||maxCost>100))throw new Error('Invalid cost ceiling');
 if(input.maxCost===null&&!untilComplete)throw new Error('Unlimited cost requires untilComplete approval');
 if(untilComplete&&schedule)throw new Error('Completion-driven runs cannot also be scheduled');
 return {stages,isolation,schedule,untilComplete,watchdog:input.watchdog===true,failurePolicy:'escalate',concurrency:integer(input.concurrency==='auto'?undefined:input.concurrency,Math.min(count,64),1,64,'concurrency'),timeoutMs:integer(input.timeoutMs,600000,1000,1800000,'child deadline'),maxCalls,tokenLimitMode:input.maxTokens==null?'audit':'hard',maxTokens:input.maxTokens==null?null:integer(input.maxTokens,undefined,1000,2000000,'token budget'),maxCost,context:input.context==='fork'?'fork':'fresh'};
}
export function forkContext(entries) {
 return entries.filter(e=>e.type==='message'&&['user','assistant'].includes(e.message?.role)).slice(-24).map(e=>`${e.message.role}: ${typeof e.message.content==='string'?e.message.content:(e.message.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')}`).join('\n\n').slice(-24000);
}
