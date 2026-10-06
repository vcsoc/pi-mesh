import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { teamWorkRequest } from '../team-work.mjs';
import { compileWorkflow,loadProfiles } from '../workflow.mjs';
import { atomicJSON,enqueueControl,controlReceipt,readRun } from '../fleet-store.mjs';
import { supervise } from '../runner.mjs';
import { resumeSpecification } from '../fleet.mjs';
const opts={activeTools:['read','bash','edit','write'],currentModel:'fake/model',availableModels:['fake/model']};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(check){const end=Date.now()+3000;while(Date.now()<end){if(check())return;await sleep(10);}throw new Error('test wait timed out');}
function setup(t,input={},legacy=false){
 const dir=mkdtempSync(join(tmpdir(),'mesh-completion-')),id=randomUUID(),run=join(dir,'runs',id);mkdirSync(run,{recursive:true});
 const profiles=loadProfiles(dir,dir),plan=compileWorkflow({isolation:'shared',untilComplete:true,maxCost:null,tasks:[{profile:'scout',task:'Finish request'}],...input},profiles,opts);
 if(legacy)delete plan.tokenLimitMode; // Already-approved historical grants used token checkpoints.
 atomicJSON(join(run,'spec.json'),{id,plan,cwd:dir,project:dir,dataDirectory:dir,parentId:'fixture',systemPrompt:'test'});
 atomicJSON(join(run,'state.json'),{id,project:dir,state:'starting',heartbeat:Date.now(),steps:[],workspaces:[]});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,id,run};
}
function session(output,tokens=1200){let cb;const messages=[];return {messages,subscribe(fn){cb=fn;return()=>{}},async prompt(){const message={role:'assistant',stopReason:'stop',content:[{type:'text',text:output}],usage:{totalTokens:tokens,cost:{total:.01}}};messages.push(message);cb({type:'message_end',message});},async abort(){},getLastAssistantText:()=>output,dispose(){}};}
test('new team drafts remain bounded while explicit continuation and independent gates are supported',t=>{
 assert.throws(()=>teamWorkRequest('  '),/team request/);
 const request=teamWorkRequest('Build a training app');assert.equal(request.background,true);
 const dir=mkdtempSync(join(tmpdir(),'mesh-team-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const plan=compileWorkflow(request.definition,loadProfiles(dir,dir),opts);
 assert.equal(plan.untilComplete,false);assert.equal(plan.maxCost,10);
 const automatic=compileWorkflow({...request.definition,untilComplete:true,maxCost:null},loadProfiles(dir,dir),opts);
 assert.equal(automatic.untilComplete,true);assert.equal(automatic.maxCost,null);
 assert.deepEqual(plan.stages.map(s=>s.tasks[0].profile),['scout','developer','tester','reviewer']);
 assert.ok(plan.stages.slice(1).every(s=>s.tasks[0].acceptance[0].equals.verdict==='pass'));
 assert.throws(()=>compileWorkflow({tasks:[{task:'x'}],maxCost:null},loadProfiles(dir,dir),opts),/Unlimited cost/);
});
test('legacy completion policy crosses token and spawn checkpoints and repairs failed gates',async t=>{
 const {run}=setup(t,{maxTokens:1000,maxCalls:1,tasks:[{profile:'scout',task:'finish',acceptance:[{type:'json',equals:{verdict:'pass'}}]}]},true);
 let calls=0;const result=await supervise(run,{factory:async()=>session(JSON.stringify({verdict:++calls<3?'fail':'pass'}))});
 assert.equal(result.state,'completed');assert.equal(result.calls,3);assert.equal(result.usage.tokens,3600);
 assert.equal(result.steps.at(-1).acceptance[0].passed,true);
});
test('automatic mode has no default token checkpoint but a new optional ceiling is hard',async t=>{
 const uncapped=setup(t),result=await supervise(uncapped.run,{factory:async()=>session('done',400001)});
 assert.equal(result.state,'completed');assert.equal(result.usage.tokens,400001);
 assert.doesNotMatch(readFileSync(join(uncapped.run,'events.jsonl'),'utf8'),/token-checkpoint/);
 const capped=setup(t,{maxTokens:1000}),limited=await supervise(capped.run,{factory:async()=>session('partial',1200)});
 assert.equal(limited.state,'cancelled');assert.match(limited.error,/token ceiling/);
});
test('resume preserves untransferred interventions and old immutable limits',t=>{
 const {dir,id,run}=setup(t,{maxTokens:1000},true);
 atomicJSON(join(run,'state.json'),{id,project:dir,state:'failed',heartbeat:Date.now(),usage:{tokens:1200,cost:.03},calls:2,workspaces:[],pendingSteering:['queued'],steps:[{id:'one',state:'failed',pendingInterventions:['retained']},{id:'two',state:'failed',pendingInterventions:['already transferred'],pendingTransferred:true}]});
 const resumed=resumeSpecification(dir,id,dir);
 assert.deepEqual(resumed.pendingSteering,['queued','retained']);
 assert.equal(resumed.plan.maxTokens,1000);assert.equal(resumed.plan.maxCost,null);assert.equal(resumed.plan.tokenLimitMode,undefined);
 assert.equal(resumed.priorUsage.tokens,1200);assert.equal(resumed.priorCalls,2);
});
test('user steering interrupts current prompt and is processed before original work resumes',async t=>{
 const {dir,id,run}=setup(t);let resolve,cb,prompts=[],aborts=0;const messages=[];
 const child={messages,subscribe(fn){cb=fn;return()=>{}},async prompt(note){prompts.push(note);if(prompts.length===1)await new Promise(r=>{resolve=r});const message={role:'assistant',stopReason:prompts.length===1?'aborted':'stop',content:[{type:'text',text:'done'}]};messages.push(message);cb({type:'message_end',message});},async abort(){aborts++;resolve?.()},getLastAssistantText:()=> 'done',dispose(){}};
 const pending=supervise(run,{factory:async()=>child});await wait(()=>prompts.length===1);
 const receipt=enqueueControl(dir,id,'steer','Use PostgreSQL instead');const result=await pending;
 assert.equal(result.state,'completed');assert.equal(aborts,1);assert.equal(prompts.length,2);
 assert.match(prompts[1],/Process this user intervention FIRST/);assert.match(prompts[1],/PostgreSQL/);
 assert.equal(controlReceipt(dir,id,receipt.id).state,'interrupt-requested');
});
test('pause cancels active work promptly and preserves it until continue',async t=>{
 const {dir,id,run}=setup(t);let resolve,cb,prompts=0,aborts=0;const messages=[];
 const child={messages,subscribe(fn){cb=fn;return()=>{}},async prompt(){prompts++;if(prompts===1)await new Promise(r=>{resolve=r});const message={role:'assistant',stopReason:prompts===1?'aborted':'stop',content:[{type:'text',text:'done'}]};messages.push(message);cb({type:'message_end',message});},async abort(){aborts++;resolve?.()},getLastAssistantText:()=> 'done',dispose(){}};
 const pending=supervise(run,{factory:async()=>child});await wait(()=>prompts===1);const start=Date.now();enqueueControl(dir,id,'pause');await wait(()=>aborts===1);
 assert.ok(Date.now()-start<500);await sleep(150);assert.equal(prompts,1);assert.equal(readRun(dir,id).state,'paused');
 enqueueControl(dir,id,'continue');assert.equal((await pending).state,'completed');assert.equal(prompts,2);
});
test('runtime checkpoints resume the same retained session instead of cancelling',async t=>{
 const {run}=setup(t,{timeoutMs:1000});let resolve,cb,count=0,aborts=0;const messages=[];
 const child={messages,subscribe(fn){cb=fn;return()=>{}},async prompt(){count++;if(count===1)await new Promise(r=>{resolve=r});const message={role:'assistant',stopReason:count===1?'aborted':'stop',content:[{type:'text',text:'done'}]};messages.push(message);cb({type:'message_end',message});},async abort(){aborts++;resolve?.()},getLastAssistantText:()=> 'done',dispose(){}};
 const result=await supervise(run,{factory:async()=>child});assert.equal(result.state,'completed');assert.equal(count,2);assert.equal(aborts,1);
 assert.match(readFileSync(join(run,'events.jsonl'),'utf8'),/Runtime checkpoint/);
});
test('three failed acceptance passes pause for input rather than looping or failing terminally',async t=>{
 const {dir,id,run}=setup(t,{tasks:[{profile:'scout',task:'finish',acceptance:[{type:'json',equals:{verdict:'pass'}}]}]});let count=0;
 const pending=supervise(run,{factory:async()=>session(JSON.stringify({verdict:++count<=3?'fail':'pass'}))});
 await wait(()=>readRun(dir,id).state==='paused');assert.equal(count,3);assert.match(readRun(dir,id).pauseReason,/acceptance failures/);
 enqueueControl(dir,id,'steer','Dependency is now available; retry');assert.equal((await pending).state,'completed');assert.equal(count,4);
});
test('ignored intervention cancellation pauses for recovery and retains user input',async t=>{
 const {dir,id,run}=setup(t);let started=false;
 const pending=supervise(run,{factory:async()=>({messages:[],subscribe:()=>()=>{},prompt(){started=true;return new Promise(()=>{});},async abort(){},dispose(){}})});
 await wait(()=>started);enqueueControl(dir,id,'steer','Preserve this correction');
 const end=Date.now()+5000;while(readRun(dir,id).state!=='paused'&&Date.now()<end)await sleep(20);
 assert.equal(readRun(dir,id).state,'paused');assert.match(readRun(dir,id).pauseReason,/Recovery requires user input/);
 assert.ok(readRun(dir,id).pendingSteering.some(note=>note.includes('Preserve this correction')));
 enqueueControl(dir,id,'stop');assert.equal((await pending).state,'cancelled');
});
test('pause interrupts a host gate and reruns acceptance after processing input',async t=>{
 const {dir,id,run}=setup(t,{tasks:[{profile:'scout',task:'verify',acceptance:[{type:'command',command:process.execPath,args:['-e','setTimeout(()=>process.exit(0),700)'],timeoutMs:2000}]}]});
 let prompts=0;const child=session('done',1),basePrompt=child.prompt;child.prompt=async note=>{prompts++;await basePrompt(note);};
 const pending=supervise(run,{factory:async()=>child});await wait(()=>prompts===1);await sleep(100);enqueueControl(dir,id,'pause');
 await wait(()=>readRun(dir,id).state==='paused');enqueueControl(dir,id,'continue');
 const result=await pending;assert.equal(result.state,'completed');assert.equal(prompts,2);assert.equal(result.steps[0].acceptance[0].passed,true);
});
test('cost ceiling pauses and cannot be bypassed with continue',async t=>{
 const {dir,id,run}=setup(t,{maxCost:.001});const pending=supervise(run,{factory:async()=>session('done')});
 await wait(()=>readRun(dir,id).state==='paused');assert.equal(readRun(dir,id).pauseReason,'spending-limit');
 const receipt=enqueueControl(dir,id,'continue');await wait(()=>{try{return controlReceipt(dir,id,receipt.id).state==='rejected'}catch{return false}});
 enqueueControl(dir,id,'stop');assert.equal((await pending).state,'cancelled');
});
