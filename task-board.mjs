import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJSON,readJSON,storeLock} from './fleet-store.mjs';
export const TASK_COLUMNS=['Backlog','To Do','In Progress','Testing','Done'];
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status,code:'TASK_CONFLICT'})};
const text=(v,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||v.includes('\0'))fail('Invalid task text',400);return v};
const profile=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value))fail('Invalid task profile',400);return value};
const hash=project=>createHash('sha256').update(project).digest('hex');
export class TaskBoard {
 constructor(directory){this.directory=join(directory,'boards');mkdirSync(this.directory,{recursive:true,mode:0o700})}
 read(project){const file=join(this.directory,hash(project)+'.json');return existsSync(file)?readJSON(file):{project,revision:0,tasks:[]}}
 change(project,operation){
  try{return storeLock(this.directory,hash(project),()=>{const board=this.read(project),result=operation(board);board.revision++;atomicJSON(join(this.directory,hash(project)+'.json'),board);return structuredClone(result)})}
  catch(error){if(error.code==='EEXIST')fail('Board busy; refresh and retry');throw error}
 }
 create(project,input,actor){return this.change(project,board=>{
  if(board.tasks.length>=4096)fail('Project board task limit reached',400);
  if(input.runId&&board.tasks.some(t=>t.runId===input.runId&&t.stepId===input.stepId&&(t.cycle||1)===(input.cycle||1)))return board.tasks.find(t=>t.runId===input.runId&&t.stepId===input.stepId&&(t.cycle||1)===(input.cycle||1));
  const task={id:randomUUID(),version:1,title:text(input.title,300),description:text(input.description||input.title),profile:profile(input.profile||'worker'),column:'Backlog',createdBy:actor,createdAt:new Date().toISOString(),comments:[],history:[],...input.runId?{runId:input.runId,stepId:input.stepId,cycle:input.cycle||1}: {}};board.tasks.push(task);return task;
 })}
 update(project,id,version,actor,operation,{lease,internal=false}={}){return this.change(project,board=>{
  const task=board.tasks.find(t=>t.id===id);if(!task)fail('Task not found',404);
  if(task.version!==version&&!internal)fail('Task changed. Refresh before saving.');
  const owned=()=>{if(task.owner!==actor)fail('Task belongs to another agent');if(task.lease&&task.lease!==lease)fail('Task lease is stale')};
  if(operation.action==='refine'){
   if(!['Backlog','To Do'].includes(task.column)||task.owner||task.runId)fail('Claimed or approved tasks are frozen; add a comment or request fresh approval');
   if(!['title','description','profile'].some(key=>operation[key]!==undefined))fail('Refinement needs a title, description or profile',400);
   if(operation.title!==undefined)task.title=text(operation.title,300);if(operation.description!==undefined)task.description=text(operation.description);if(operation.profile!==undefined)task.profile=profile(operation.profile);
  }else if(operation.action==='ready'){if(task.column!=='Backlog'||task.owner)fail('Only unclaimed backlog tasks can enter To Do');task.column='To Do'}
  else if(operation.action==='claim'){
   if(task.column!=='To Do'||task.owner)fail('Task already claimed or not in To Do');if(internal&&operation.runId){if(task.runId&&task.runId!==operation.runId)fail('Task is bound to another run');task.runId=operation.runId;task.stepId=operation.stepId}task.owner=actor;task.lease=randomUUID();task.column='In Progress';task.startedAt=new Date().toISOString();delete task.blocker;
  }else if(operation.action==='testing'){owned();if(task.column!=='In Progress')fail('Task is not in progress');task.column='Testing'}
  else if(operation.action==='done'){owned();if(!internal||operation.verified!==true||task.column!=='Testing'||task.blocker)fail('Done requires supervisor-verified acceptance evidence');task.column='Done';task.evidence=operation.evidence;delete task.lease;task.finishedAt=new Date().toISOString()}
  else if(operation.action==='block'){owned();const question=text(operation.question);task.blocker=task.blocker?.question===question?task.blocker:{question,level:'orchestrator',at:Date.now()}}
  else if(operation.action==='escalate'){if(!task.blocker)fail('Task is not blocked');task.blocker.level='user'}
  else if(operation.action==='answer'){if(task.comments.length>=1000)fail('Task comment limit reached',400);if(!task.blocker)fail('Task is not blocked');task.blocker.answer=text(operation.message);task.blocker.answeredBy=actor;task.comments.push({id:randomUUID(),author:actor,kind:'decision',text:operation.message,at:new Date().toISOString()})}
  else if(operation.action==='retry'){owned();if(!internal||!task.blocker)fail('Only the owning supervisor may release a blocked attempt');task.column='To Do';delete task.owner;delete task.lease;delete task.blocker}
  else if(operation.action==='comment'){if(task.comments.length>=1000)fail('Task comment limit reached',400);task.comments.push({id:randomUUID(),author:actor,kind:operation.kind==='decision'?'decision':'comment',text:text(operation.message),at:new Date().toISOString()})}
  else fail('Unknown task action',400);
  task.version++;task.updatedAt=new Date().toISOString();task.history.push({version:task.version,action:operation.action,actor,at:task.updatedAt});task.history=task.history.slice(-1000);return task;
 })}
}
