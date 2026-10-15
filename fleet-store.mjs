import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Fail busy rather than race approval quotas or lose concurrent mission decisions.
export function storeLock(directory,key,operation) {
 const root=join(directory,'.locks');mkdirSync(root,{recursive:true,mode:0o700});
 const lock=join(root,key);mkdirSync(lock);writeFileSync(join(lock,'owner'),String(process.pid),{mode:0o600});
 let result;
 try {result=operation()}catch(error){rmSync(lock,{recursive:true,force:true});throw error}
 if(result?.then)return result.finally(()=>rmSync(lock,{recursive:true,force:true}));
 rmSync(lock,{recursive:true,force:true});return result;
}
export const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
export function ownsLiveProcess(run) {
 if(!terminal.has(run.state))return true;
 if(run.state!=='interrupted'||!Number.isInteger(run.pid)||run.pid<2)return false;
 try{process.kill(run.pid,0);return true}catch(error){return error.code!=='ESRCH'}
}
export function identifier(id) {
 if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid Mesh run identifier');
 return id;
}
export function atomicJSON(file, data) {
 const temp = `${file}.${randomUUID()}.tmp`;
 writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); renameSync(temp, file);
}
export function readJSON(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export const runDirectory = (directory,id) => join(directory,'runs',identifier(id));
export function readRun(directory,id,summary=false) {
 const dir=runDirectory(directory,id),state=readJSON(join(dir,summary&&existsSync(join(dir,'summary.json'))?'summary.json':'state.json'));
 if (!terminal.has(state.state) && Date.now()-Number(state.heartbeat||0)>15000) {
  // Never replay uncertain work. A stale lease is evidence of an interrupted owner,
  // not permission to spawn or signal a recycled PID.
  state.state='interrupted';state.error='Runner heartbeat expired; explicit resume is required';
 }
 return state;
}
export function listRuns(directory,project) {
 const root=join(directory,'runs');if(!existsSync(root))return [];
 return readdirSync(root).flatMap(id=>{try{const run=readRun(directory,id,true);return !project||run.project===project?[run]:[]}catch{return []}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function enqueueControl(directory,id,action,message='',decision={}) {
 if(!['stop','steer','pause','continue','decide'].includes(action))throw new Error('Unsupported fleet control');
 const state=readRun(directory,id);
 if(terminal.has(state.state))throw new Error('Runner is not live; resume requires a new approved run');
 if(action==='steer'&&(typeof message!=='string'||!message.trim()||message.length>12000))throw new Error('Steering requires 1–12000 characters');
 if(action==='decide'&&(!/^[a-z][a-z0-9_-]{0,47}$/.test(decision.taskId||'')||!['retry','escalate'].includes(decision.decision)||typeof message!=='string'||message.length>12000||decision.decision==='retry'&&!message.trim()))throw Error('Task decision requires taskId, retry/escalate and a directive for retry');
 const receipt=randomUUID(),folder=join(runDirectory(directory,id),'controls');mkdirSync(folder,{recursive:true,mode:0o700});
 if(readdirSync(folder).length>=128)throw new Error('Runner control queue is full');
 atomicJSON(join(folder,`${receipt}.json`),{id:receipt,action,message,...(action==='decide'?{taskId:decision.taskId,decision:decision.decision}:{}),createdAt:Date.now()});
 return {id:receipt,runId:id,state:'queued'};
}
export function controlReceipt(directory,id,receipt) {
 return readJSON(join(runDirectory(directory,id),'receipts',`${identifier(receipt)}.json`));
}
