import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {demoCount,demoCases,demoWorkRequest,demoReport} from '../demo-work.mjs';
import {compileScopedWorkflow} from '../team-scope.mjs';
import {workflowReviewLines,workflowSummaryLines} from '../work-review.mjs';
import {supervise,checkGate} from '../runner.mjs';
import {atomicJSON} from '../fleet-store.mjs';
import {runVerification} from '../fleet.mjs';
const options={agentDir:tmpdir(),activeTools:['read','grep','find','ls','bash','edit','write'],currentModel:'fixture/demo',availableModels:['fixture/demo']};
const profiles={scout:{write:true,tools:['bash','write'],prompt:'UNSAFE override',model:'unavailable/override'}};
const compile=count=>compileScopedWorkflow(demoWorkRequest(count).definition,profiles,options);

test('demo validates exact count and preserves existing spawn/stage/concurrency limits including22 and64',()=>{
 for(const bad of ['',0,-1,65,999,'01','1.5','22 agents','1e1','NaN',null,undefined,Infinity])assert.throws(()=>demoCount(bad),/Usage: \/mesh demo/);
 for(const count of [1,3,8,22,64]){
  assert.equal(demoCount(String(count)),count);const request=demoWorkRequest(count),plan=compile(count);
  assert.equal(request.background,true);assert.equal(plan.demoCount,count);assert.equal(plan.maxCalls,count);
  assert.equal(plan.concurrency,count);assert(plan.stages.length<=16);
  assert(plan.stages.every(s=>s.parallel&&s.retries===0&&s.tasks.length<=64));
  const tasks=plan.stages.flatMap(s=>s.tasks);assert.equal(tasks.length,count);assert.equal(new Set(tasks.map(t=>t.id)).size,count);
  assert.equal(plan.maxCost,Math.max(1,count*.25));assert.equal(plan.maxTokens,null);assert.equal(plan.timeoutMs,15000);
  assert.equal(plan.context,'fresh');assert.equal(plan.isolation,'shared');assert.equal(plan.untilComplete,false);assert.equal(plan.watchdog,false);assert.equal(plan.schedule,null);
  for(const task of tasks){assert.equal(task.model,'fixture/demo');assert.equal(task.write,false);assert.deepEqual(task.tools,[]);assert.deepEqual(task.extensions,[]);assert.deepEqual(task.extensionTools,[]);assert.doesNotMatch(task.prompt,/UNSAFE/);assert.equal(task.acceptance.length,1);}
 }
 assert.throws(()=>compileScopedWorkflow(demoWorkRequest(3).definition,profiles,{...options,availableModels:[]}),/unavailable/);
});

test('reserved demo scope refuses mutable permissions, tasks, gates, models, budgets and continuation',()=>{
 const original=demoWorkRequest(22).definition;
 for(const mutate of [d=>d.stages[0].tasks[0].task='Read secrets',d=>d.stages[0].tasks[0].profile='worker',d=>d.stages[0].tasks[0].model='fixture/other',d=>d.stages[0].tasks[0].extensions=['danger'],d=>d.stages[0].tasks[0].acceptance[0].equals.result=0,d=>d.stages[0].tasks[0].acceptance=[{type:'command',command:'touch',args:['unsafe']}],d=>d.stages[0].retries=1,d=>d.concurrency=4,d=>d.maxCost=null,d=>d.untilComplete=true,d=>d.watchdog=true,d=>d.context='fork',d=>d.schedule={at:'tomorrow'},d=>d.extra='unexpected',d=>d.demoCount=3]){
  const modified=structuredClone(original);mutate(modified);assert.throws(()=>compileScopedWorkflow(modified,profiles,options),/Demo scope is fixed/);
 }
 assert.deepEqual(original,demoWorkRequest(22).definition);assert.equal(profiles.scout.write,true);
});

test('all tiny tasks require strict matching JSON; wrong result, task, status or prose never passes',async()=>{
 const tasks=compile(22).stages.flatMap(s=>s.tasks);
 for(const task of tasks){
  const good=task.acceptance[0].equals;assert.equal((await checkGate(task.acceptance[0],JSON.stringify(good),'.')).passed,true);
  for(const value of [{...good,result:null},{...good,task:'other'},{...good,status:'running'},[good],null])assert.equal((await checkGate(task.acceptance[0],JSON.stringify(value),'.')).passed,false);
  assert.equal((await checkGate(task.acceptance[0],'```json\n'+JSON.stringify(good)+'\n```','.')).passed,false);
 }
});

test('review accurately discloses no workspace tools, real usage and22 concurrent children',()=>{
 const plan=compile(22),summary={project:'/fixture',scope:'demo',isolation:plan.isolation,context:plan.context,background:true,limits:{concurrency:plan.concurrency,spawns:plan.maxCalls,tokens:plan.maxTokens,estimatedCost:plan.maxCost,childDeadlineMs:plan.timeoutMs},steps:plan.stages.map(s=>({...s,tasks:s.tasks.map(t=>({...t,role:t.profile}))}))};
 const review=workflowReviewLines(summary).join('\n'),brief=workflowSummaryLines(summary).join('\n');
 assert.match(review,/DEMO \/ SMOKE TEST/);assert.match(review,/real model usage/);assert.match(review,/Tools: \(none\)/);assert.match(review,/child spawns: 22 \| concurrency: 22/);assert.match(review,/Estimated-cost ceiling: \$5.5/);assert.doesNotMatch(review,/workers may edit/);
 assert.match(brief,/22 workers, up to 22 at once/);assert.doesNotMatch(brief,/edits your current files/);
});

function prepare(t,count){
 const directory=mkdtempSync(join(tmpdir(),'mesh-demo-unit-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const id=randomUUID(),run=join(directory,'runs',id);mkdirSync(run,{recursive:true});writeFileSync(join(directory,'sentinel.txt'),'unchanged');
 const spec={id,plan:compile(count),cwd:directory,project:directory,dataDirectory:directory,systemPrompt:'Synthetic demo only',parentId:'fixture'};
 atomicJSON(join(run,'spec.json'),spec);atomicJSON(join(run,'state.json'),{id,project:directory,state:'starting',createdAt:new Date().toISOString(),heartbeat:Date.now(),steps:[],workspaces:[]});
 return{directory,run,spec};
}
function fakeFactory({bad=false}={}){
 let active=0,peak=0;const calls=[];
 return{calls,peak:()=>peak,factory:async task=>{
  assert.deepEqual(task.tools,[]);assert.deepEqual(task.extensions,[]);calls.push(task.id);const output=JSON.stringify({...task.acceptance[0].equals,...(bad&&task.id==='demo-001'?{result:999}:{})});let listener;
  const messages=[];
  return{messages,sessionFile:null,subscribe(fn){listener=fn;return()=>{}},async prompt(){peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;const message={role:'assistant',stopReason:'stop',content:[{type:'text',text:output}],usage:{input:10,output:2,totalTokens:12,cost:{total:0}}};messages.push(message);listener({type:'message_end',message})},getLastAssistantText:()=>output,async abort(){},async steer(){},dispose(){}};
 }};
}

test('real supervisor completes exactly22/64 synthetic children, bounds concurrency and reports every result without project work',async t=>{
 for(const count of [22,64]){
  const f=prepare(t,count),fake=fakeFactory(),finished=await supervise(f.run,{factory:fake.factory});
  assert.equal(finished.state,'completed');assert.equal(finished.calls,count);assert.equal(finished.steps.length,count);assert(fake.peak()<=count);assert(fake.peak()>4);assert.equal(fake.calls.length,count);
  assert.deepEqual(finished.workspaces,[]);assert.equal(readFileSync(join(f.directory,'sentinel.txt'),'utf8'),'unchanged');assert.equal(runVerification(finished,f.spec).verified,true);
  const report=demoReport(finished,f.spec);assert.match(report,/^Mesh demo .*: PASS/);assert.match(report,new RegExp(`accepted: ${count}/${count}`));
  for(const item of demoCases(count))assert.match(report,new RegExp(item.id+' ·'));
  await assert.rejects(supervise(f.run,{factory:fake.factory}),/EEXIST/);assert.equal(fake.calls.length,count,'never replay a finished demo');
  const missing=structuredClone(finished);missing.steps.pop();assert.doesNotMatch(demoReport(missing,f.spec),/^Mesh demo .*: PASS/);
  const forged=structuredClone(finished);forged.steps[0].output='{"task":"demo-001","status":"done","result":0}';assert.doesNotMatch(demoReport(forged,f.spec),/^Mesh demo .*: PASS/);
  const cancelled={...finished,state:'cancelled'};assert.doesNotMatch(demoReport(cancelled,f.spec),/^Mesh demo .*: PASS/);
 }
});

test('modern demo acceptance requires elapsed evidence within15s; immutable historical60s grants retain their contract',()=>{
 const item=demoCases(1)[0],row={id:item.id,state:'completed',elapsedMs:2,output:JSON.stringify({task:item.id,result:item.expected,status:'done'}),acceptance:[{passed:true}]},run={id:'fixture',state:'completed',steps:[row]},spec={plan:{demoCount:1,failurePolicy:'escalate',timeoutMs:15000}};
 assert.match(demoReport(run,spec),/: PASS/);row.elapsedMs=16000;assert.match(demoReport(run,spec),/NOT VERIFIED/);delete row.elapsedMs;assert.match(demoReport(run,spec),/NOT VERIFIED/);row.elapsedMs=16000;delete spec.plan.failurePolicy;spec.plan.timeoutMs=60000;assert.match(demoReport(run,spec),/: PASS/);assert.match(demoReport(run,spec),/60 seconds runtime \(legacy grant\)/);
});
test('wrong synthetic result fails without retries; unstarted agents and partial evidence are reported honestly',async t=>{
 const f=prepare(t,22),fake=fakeFactory({bad:true});
 // Old immutable grants keep their fail-fast settlement policy; new grants are covered by project-flow tests.
 delete f.spec.plan.failurePolicy;atomicJSON(join(f.run,'spec.json'),f.spec);
 const finished=await supervise(f.run,{factory:fake.factory});
 assert.equal(finished.state,'failed');assert.equal(finished.steps.length,22);assert.equal(fake.calls.length,22);assert.equal(runVerification(finished,f.spec).verified,false);
 const report=demoReport(finished,f.spec);assert.match(report,/NOT VERIFIED \/ INCOMPLETE/);assert.match(report,/demo-001 .*failed.*FAIL.*result=999/);assert.match(report,/demo-022 .*completed.*PASS/);
});
