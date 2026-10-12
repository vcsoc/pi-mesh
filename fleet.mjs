import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, realpathSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJSON, readJSON, readRun, runDirectory, listRuns, terminal, identifier, enqueueControl, storeLock, ownsLiveProcess } from './fleet-store.mjs';
const runner=fileURLToPath(new URL('./runner.mjs',import.meta.url));
export function canonicalProject(cwd) {
 let root=realpathSync(cwd),cursor=root;
 while(true) {if(existsSync(join(cursor,'.git'))){root=cursor;break}const parent=dirname(cursor);if(parent===cursor)break;cursor=parent}
 return root;
}
export function projectHash(root) {return createHash('sha256').update(`agent-mesh-project\0${process.platform==='win32'?root.toLowerCase():root}`).digest('hex')}
export function resolveSDKFile(packageDir, agentDir) {
 const direct = join(packageDir, 'dist', 'index.js');
 if (existsSync(direct)) return direct;
 const version = readJSON(join(packageDir, 'package.json')).version;
 if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Cannot determine the installed Pi SDK version');
 const prefix = join(agentDir, 'sdk', version);
 const root = join(prefix, 'node_modules', '@earendil-works', 'pi-coding-agent');
 const cached = join(root, 'dist', 'index.js');
 if (existsSync(cached) && readJSON(join(root, 'package.json')).version === version) return cached;
 throw new Error(`Standalone Pi needs a matching Node SDK for Mesh workers. Install @earendil-works/pi-coding-agent@${version} into ${prefix}`);
}
export function nodeExecutable(executable = process.execPath) {
 return /^node(?:\.exe)?$/i.test(basename(executable)) ? executable : 'node';
}
export function launchRun(directory,spec,{execPath=process.execPath,node=nodeExecutable(execPath),spawnProcess=spawn}={}) {
 return storeLock(directory,'launch',()=>{
 const allActive=listRuns(directory).filter(ownsLiveProcess);
 if(allActive.length>=8)throw new Error('At most eight live runners across Mesh');
 if(spec.resumeWorkspaces?.some(w=>allActive.some(r=>r.workspaces.some(other=>other.path===w.path))))throw new Error('A retained workspace is already owned by a live runner');
 const active=allActive.filter(r=>r.project===spec.project);
 if(active.length>=4)throw new Error('At most four live workflow runners per project');
 if(active.some(r=>r.isolation==='shared')||spec.plan.isolation==='shared'&&active.length)throw new Error('Shared workspace execution cannot overlap another project run');
 const id=randomUUID(),dir=runDirectory(directory,id);
 mkdirSync(dir,{recursive:true,mode:0o700});
 spec={...spec,id,dataDirectory:directory};
 const state={id,project:spec.project,parentId:spec.parentId,missionId:spec.missionId||null,resumeOf:spec.resumeOf||null,createdAt:new Date().toISOString(),state:'starting',isolation:spec.plan.isolation,heartbeat:Date.now(),steps:[],workspaces:spec.resumeWorkspaces||[],usage:{tokens:0,cost:0}};
 atomicJSON(join(dir,'spec.json'),spec);atomicJSON(join(dir,'state.json'),state);
 const log=openSync(join(dir,'runner.log'),'a',0o600);
 try {
  const child=spawnProcess(node,[runner,dir],{cwd:spec.cwd,detached:true,stdio:['ignore',log,log],env:{...process.env,PI_MESH_CHILD:'1'}});
  child.once('error',error=>{state.state='failed';state.error=`Runner launch failed: ${error.message}`;atomicJSON(join(dir,'state.json'),state)});child.unref();
 } finally {closeSync(log)}
 return {id,state:'starting',project:spec.project};
 });
}
export async function waitRun(directory,id,{signal,onUpdate,timeoutMs=0}={}) {
 const started=Date.now();
 while(true) {
  const run=readRun(directory,id);onUpdate?.(run);
  if(terminal.has(run.state))return run;
  if(signal?.aborted){enqueueControl(directory,id,'stop');throw new Error('Wait cancelled; stop receipt queued')}
  if(timeoutMs&&Date.now()-started>timeoutMs)return run;
  await new Promise(resolve=>setTimeout(resolve,300));
 }
}
export function runVerification(run,spec) {
 const issues=[];
 for(const task of spec.plan.stages.flatMap(stage=>stage.tasks)){
  if(!task.acceptance.length){issues.push(`${task.id}: no explicit acceptance gates`);continue}
  const last=run.steps.filter(step=>step.id===task.id).at(-1);
  if(!last||last.state!=='completed'||!Array.isArray(last.acceptance)||last.acceptance.length!==task.acceptance.length||last.acceptance.some(gate=>gate.passed!==true))issues.push(`${task.id}: missing passing acceptance evidence`);
 }
 return {runtime:run.state,verified:run.state==='completed'&&issues.length===0,issues};
}
export function integrationEvidence(run,spec) {
 if(run.state!=='completed')throw new Error('Only completed runs can be integrated');
 const writing=spec.plan.stages.flatMap(stage=>stage.tasks).filter(task=>task.write);
 if(!writing.length)throw new Error('No writing tasks to integrate');
 for(const task of writing){
  if(!task.acceptance.length)throw new Error(`Writing step ${task.id} has no explicit acceptance gates; review and validate its workspace manually`);
  const attempts=run.steps.filter(step=>step.id===task.id),last=attempts.at(-1);
  if(!last||last.state!=='completed'||!Array.isArray(last.acceptance)||last.acceptance.length!==task.acceptance.length||last.acceptance.some(gate=>gate.passed!==true))throw new Error(`Writing step ${task.id} lacks passing acceptance evidence`);
 }
 return {writingSteps:writing.map(task=>task.id),accepted:true};
}
export function resumeSpecification(directory,id,project) {
 const previous=readRun(directory,id);if(previous.project!==project)throw new Error('Run belongs to another project');
 if(!terminal.has(previous.state))throw new Error('Only a finished/interrupted run can resume');
 if(previous.state==='interrupted'&&ownsLiveProcess(previous))throw new Error('Previous runner PID still exists; resolve its ownership before resuming');
 const spec=readJSON(join(runDirectory(directory,id),'spec.json'));
 if(spec.plan.schedule){const remaining=spec.plan.schedule.maxRuns-(previous.completedCycles||0);spec.plan.schedule=remaining>0?{...spec.plan.schedule,maxRuns:remaining,at:Math.max(Date.now(),Date.parse(previous.nextAt)||0)}:null}
 spec.resumeOf=id;
 spec.resumeSessions=Object.fromEntries(previous.steps.filter(s=>s.sessionFile).map(s=>[s.id,s.sessionFile]));
 spec.resumeWorkspaces=previous.workspaces;
 const currentCycle=previous.cycle||1;
 spec.completedSteps=[...new Map(previous.steps.filter(s=>(s.cycle??Number(s.key?.split('-')[0]))===currentCycle).map(s=>[s.id,s])).values()].filter(s=>s.state==='completed');
 spec.priorUsage=previous.usage;spec.priorCalls=previous.calls||previous.steps.length;spec.pendingSteering=[...(previous.pendingSteering||[]),...previous.steps.filter(s=>!s.pendingTransferred).flatMap(s=>s.pendingInterventions||[])];
 return spec;
}
export function listMissions(directory,project) {
 const root=join(directory,'missions');if(!existsSync(root))return [];
 return readdirSync(root).flatMap(file=>{try{const m=readJSON(join(root,file));return m.project===project?[m]:[]}catch{return []}});
}
export function updateMission(directory,project,input) {
 return storeLock(directory,'missions',()=>{
 const root=join(directory,'missions');mkdirSync(root,{recursive:true,mode:0o700});
 const id=input.id?identifier(input.id):randomUUID(),file=join(root,`${id}.json`);
 const previous=existsSync(file)?readJSON(file):null;
 if(previous&&previous.project!==project)throw new Error('Mission belongs to another project');
 if(!previous&&(typeof input.objective!=='string'||!input.objective.trim()||input.objective.length>12000))throw new Error('Mission objective required');
 const mission=previous||{id,project,objective:input.objective,createdAt:new Date().toISOString(),status:'open',decisions:[]};
 if(input.decision) {if(typeof input.decision!=='string'||input.decision.length>4000)throw new Error('Invalid decision');mission.decisions.push({at:new Date().toISOString(),text:input.decision})}
 if(input.status) {
  if(!['open','accepted','cancelled'].includes(input.status))throw new Error('Invalid mission status');
  if(input.status==='accepted') {
   const linked=listRuns(directory,project).filter(r=>r.missionId===id),superseded=new Set(linked.filter(r=>r.state==='completed'&&r.resumeOf).map(r=>r.resumeOf)),runs=linked.filter(r=>!superseded.has(r.id));
   mission.superseded=[...superseded];
   if(!runs.length||runs.some(r=>r.state!=='completed')||!runs.some(r=>r.steps.some(s=>s.acceptance?.length)))throw new Error('Mission acceptance requires completed linked runs and passing explicit gates');
   mission.evidence=runs.map(r=>r.id);
  }
  mission.status=input.status;
 }
 mission.updatedAt=new Date().toISOString();atomicJSON(file,mission);return mission;
 });
}
export function runEvents(directory,id) {
 const file=join(runDirectory(directory,id),'events.jsonl');return existsSync(file)?readFileSync(file,'utf8').slice(-64000):'';
}
