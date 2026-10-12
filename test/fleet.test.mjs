import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { roleMemory, recordHandoff } from '../context-memory.mjs';
import { roleName, allocateName, canonicalRole } from '../naming.mjs';
import { compileWorkflow, loadProfiles, forkContext } from '../workflow.mjs';
import { supervise, checkGate } from '../runner.mjs';
import { launchRun, waitRun, nodeExecutable, resolveSDKFile, resumeSpecification, integrationEvidence, runVerification, updateMission } from '../fleet.mjs';
import { atomicJSON, readRun, listRuns, enqueueControl, controlReceipt, storeLock } from '../fleet-store.mjs';
import { git, createWorkspace, workspaceEvidence, mergeWorkspace, mergeWorkspaces, cleanupWorkspace } from '../workspace.mjs';
const options={activeTools:['read','grep','find','ls','bash','edit','write'],currentModel:'fake/model',availableModels:['fake/model']};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'mesh-fleet-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const profiles=loadProfiles(dir,dir);return {dir,profiles};}
function plan(profiles,input={}){return compileWorkflow({tasks:[{profile:'scout',task:'inspect'}],...input},profiles,options)}
function prepare(dir,workflow){const id=randomUUID(),run=join(dir,'runs',id);mkdirSync(run,{recursive:true});const spec={id,plan:workflow,cwd:dir,project:dir,dataDirectory:dir,systemPrompt:'test',parentId:'test'};atomicJSON(join(run,'spec.json'),spec);atomicJSON(join(run,'state.json'),{id,project:dir,createdAt:new Date().toISOString(),heartbeat:Date.now(),state:'starting',steps:[],workspaces:[]});return {id,run,spec}}
function fake(output='{"verdict":"pass"}',delay=0,usageTokens=12) {return async()=>{
 let cb,resolve,aborted=false;const messages=[];
 return {messages,sessionFile:null,subscribe(fn){cb=fn;return()=>{}},async prompt(){await new Promise(r=>{resolve=r;setTimeout(r,delay)});const message={role:'assistant',stopReason:aborted?'aborted':'stop',content:[{type:'text',text:output}],usage:{input:10,output:2,totalTokens:usageTokens,cost:{total:.01}}};messages.push(message);cb({type:'message_end',message})},getLastAssistantText:()=>output,async abort(){aborted=true;resolve?.()},async steer(){},dispose(){}};
};}
test('a compiled Pi host launches the JavaScript runner with Node rather than passing it to Pi as a prompt', async t => {
 const {dir,profiles}=fixture(t), spec={plan:plan(profiles),cwd:dir,project:dir,parentId:'test',systemPrompt:'test',agentDir:dir,sdkFile:fileURLToPath(new URL('./fixtures/sdk.mjs',import.meta.url))};
 let selected;
 const launched=launchRun(dir,spec,{execPath:join(dir,'pi'),spawnProcess:(executable,args,options)=>{selected=executable;return spawn(executable,args,options)}});
 const finished=await waitRun(dir,launched.id,{timeoutMs:10000});
 assert.equal(selected,'node');
 assert.equal(finished.state,'completed');
 assert.ok(finished.steps[0].sessionFile);
 assert.equal(nodeExecutable(process.execPath),process.execPath);
});
test('standalone Pi finds only a matching cached SDK and missing SDKs fail before worker launch', t => {
 const {dir}=fixture(t), host=join(dir,'host'), agent=join(dir,'agent');
 mkdirSync(host,{recursive:true});writeFileSync(join(host,'package.json'),JSON.stringify({version:'1.2.3'}));
 assert.throws(()=>resolveSDKFile(host,agent),/matching Node SDK/);
 const cached=join(agent,'sdk','1.2.3','node_modules','@earendil-works','pi-coding-agent');
 mkdirSync(join(cached,'dist'),{recursive:true});writeFileSync(join(cached,'dist','index.js'),'export const fixture = true;');
 writeFileSync(join(cached,'package.json'),JSON.stringify({version:'1.2.4'}));
 assert.throws(()=>resolveSDKFile(host,agent),/matching Node SDK/);
 writeFileSync(join(cached,'package.json'),JSON.stringify({version:'1.2.3'}));
 assert.equal(resolveSDKFile(host,agent),join(cached,'dist','index.js'));
 mkdirSync(join(host,'dist'));writeFileSync(join(host,'dist','index.js'),'export const fixture = true;');
 assert.equal(resolveSDKFile(host,agent),join(host,'dist','index.js'));
});
test('detached real Node runner completes with retained sessions and explicit continuation',async t=>{
 const {dir,profiles}=fixture(t),spec={plan:plan(profiles),cwd:dir,project:dir,parentId:'test',systemPrompt:'test',agentDir:dir,sdkFile:fileURLToPath(new URL('./fixtures/sdk.mjs',import.meta.url))};
 const launched=launchRun(dir,spec),finished=await waitRun(dir,launched.id,{timeoutMs:10000});
 assert.equal(finished.state,'completed');assert.ok(existsSync(finished.steps[0].sessionFile));
 const resumed=resumeSpecification(dir,launched.id,dir);assert.equal(resumed.completedSteps.length,1);
 const next=launchRun(dir,resumed),continued=await waitRun(dir,next.id,{timeoutMs:10000});assert.equal(continued.state,'completed');assert.equal(continued.usage.tokens,finished.usage.tokens,'completed steps are not replayed');
});
test('role names use base then numeric suffixes and only reclaim offline holders',()=>{
 assert.equal(roleName('mypi','orchestrator'),'mypi-orc');assert.equal(roleName('mypi','worker'),'mypi-dev');assert.equal(canonicalRole('rev'),'reviewer');
 const agents={one:{id:'one',name:'mypi-dev',status:'working',lastSeenAt:Date.now()}};
 assert.deepEqual(allocateName(agents,'mypi-dev','two'),{name:'mypi-dev1'});agents.one.status='offline';
 assert.deepEqual(allocateName(agents,'mypi-dev','two'),{name:'mypi-dev',reclaim:'one'});
});
test('Markdown role context survives name replacement and keeps human notes unchanged',t=>{
 const {dir}=fixture(t);const first=recordHandoff(dir,{role:'worker',identity:'first',task:'scope',output:'evidence'});
 const file=roleMemory(dir,'developer').path;writeFileSync(file,'# Human decision\nKeep this rule.');
 const again=recordHandoff(dir,{role:'developer',identity:'first',output:'duplicate'});assert.equal(again,first);
 recordHandoff(dir,{role:'dev',identity:'replacement',output:'handoff two'});
 const memory=roleMemory(dir,'developer');assert.match(memory.text,/Keep this rule/);assert.match(memory.text,/evidence/);assert.match(memory.text,/handoff two/);
 assert.match(readFileSync(join(dir,'vault','30-systems','memory-index.md'),'utf8'),/Mesh role context/);
});
test('profile layers and ceilings, workflow validation and text-only fork context',t=>{
 const {dir,profiles}=fixture(t);mkdirSync(join(dir,'.pi','mesh'),{recursive:true});
 writeFileSync(join(dir,'.pi','mesh','profiles.json'),JSON.stringify({scout:{prompt:'custom',tools:['read']}}));assert.equal(loadProfiles(dir,dir).scout.prompt,'custom');
 assert.throws(()=>plan(profiles,{tasks:[{profile:'scout',task:'x',model:'other/model'}]}),/unavailable/);
 assert.throws(()=>plan(profiles,{tasks:[{profile:'scout',task:'x'}],maxCalls:0}),/spawn budget/);
 assert.throws(()=>plan(profiles,{mode:'parallel',isolation:'shared',tasks:[{profile:'worker',task:'x'},{profile:'worker',task:'y'}]}),/Parallel writers/);
 assert.throws(()=>plan(profiles,{schedule:{at:new Date().toISOString(),everyMs:2,maxRuns:2}}),/Schedule/);
 const text=forkContext([{type:'message',message:{role:'assistant',content:[{type:'thinking',thinking:'SECRET'},{type:'text',text:'public'}]}}]);assert.equal(text,'assistant: public');
 assert.equal(plan(profiles,{watchdog:true,tasks:[{profile:'worker',task:'edit'}]}).stages.length,2);
});
test('runner passes strict gates, accounts every response, persists and never replays same run',async t=>{
 const {dir,profiles}=fixture(t),{id,run}=prepare(dir,plan(profiles,{tasks:[{profile:'scout',task:'x',acceptance:[{type:'json',required:['verdict'],equals:{verdict:'pass'}}]},{profile:'reviewer',task:'y'}]}));
 const result=await supervise(run,{factory:fake()});assert.equal(result.state,'completed');assert.equal(result.usage.tokens,24);assert.equal(result.steps.length,2);assert.equal(result.steps[0].acceptance[0].passed,true);
 assert.equal(readRun(dir,id).state,'completed');assert.equal(listRuns(dir)[0].steps[0].output,undefined);
 await assert.rejects(supervise(run,{factory:fake()}),/EEXIST/);
});
test('default token auditing does not impose a ceiling, while explicit old grants retain theirs',async t=>{
 const {dir,profiles}=fixture(t),uncapped=plan(profiles);
 assert.equal(uncapped.maxTokens,null);
 const {run}=prepare(dir,uncapped),result=await supervise(run,{factory:fake('audited fixture',0,400000)});
 assert.equal(result.state,'completed');assert.equal(result.usage.tokens,400000);
 const ledger=readFileSync(join(run,'audit','usage.jsonl'),'utf8');assert.match(ledger,/\"total\":400000/);assert.doesNotMatch(ledger,/audited fixture/);
 const capped=prepare(dir,plan(profiles,{maxTokens:200000}));
 const cancelled=await supervise(capped.run,{factory:fake('partial',0,400000)});assert.equal(cancelled.state,'cancelled');assert.equal(JSON.parse(readFileSync(join(capped.run,'spec.json'),'utf8')).plan.maxTokens,200000);
});
test('shared parallel budget cancellation retains unaccepted model output',async t=>{
 const {dir,profiles}=fixture(t),{run}=prepare(dir,plan(profiles,{mode:'parallel',maxTokens:1000,tasks:[{id:'first',profile:'scout',task:'review'},{id:'second',profile:'reviewer',task:'review'}]}));
 const result=await supervise(run,{factory:fake('Evidence produced before budget cancellation',0,600)});
 assert.equal(result.state,'cancelled');assert.ok(result.usage.tokens>1000);
 assert.ok(result.steps.some(step=>step.partial&&step.output.includes('Evidence produced')));
 assert.ok(result.steps.filter(step=>step.partial).every(step=>step.state!=='completed'&&!step.acceptance?.some(g=>g.passed)),'partial output must never be accepted');
});
test('integration requires passing, explicit gates on each writing step',t=>{
 const {dir,profiles}=fixture(t),ungated=plan(profiles,{tasks:[{profile:'worker',task:'edit'}]});
 const run={state:'completed',steps:[{id:'step-1-1',state:'completed',acceptance:[]}]};
 assert.throws(()=>integrationEvidence(run,{plan:ungated}),/no explicit acceptance gates/);
 assert.deepEqual(runVerification(run,{plan:ungated}),{runtime:'completed',verified:false,issues:['step-1-1: no explicit acceptance gates']});
 const gated=plan(profiles,{tasks:[{profile:'worker',task:'edit',acceptance:[{type:'json',required:['verdict'],equals:{verdict:'pass'}}]}]});
 assert.throws(()=>integrationEvidence(run,{plan:gated}),/lacks passing acceptance evidence/);
 run.steps[0].acceptance=[{type:'json',passed:true}];assert.deepEqual(integrationEvidence(run,{plan:gated}),{writingSteps:['step-1-1'],accepted:true});
 assert.deepEqual(runVerification(run,{plan:gated}),{runtime:'completed',verified:true,issues:[]});
 run.state='cancelled';assert.throws(()=>integrationEvidence(run,{plan:gated}),/Only completed/);
});
test('conditional stages skip without launching and bounded retries leave failure evidence',async t=>{
 const {dir,profiles}=fixture(t);
 const workflow=plan(profiles,{stages:[{tasks:[{id:'first',profile:'scout',task:'x'}]},{when:{step:'first',field:'verdict',equals:'fail'},tasks:[{id:'second',profile:'scout',task:'y'}]}]});
 const {run}=prepare(dir,workflow);assert.equal((await supervise(run,{factory:fake()})).steps.length,1);
 const bad=prepare(dir,plan(profiles,{stages:[{tasks:[{profile:'scout',task:'bad',acceptance:[{type:'json',equals:{verdict:'pass'}}]}],retries:2}]}));
 const result=await supervise(bad.run,{factory:fake('not json')});assert.equal(result.state,'failed');assert.equal(result.steps.length,3);
});
test('controls have applied receipts; stop cancels active jobs',async t=>{
 const {dir,profiles}=fixture(t),{id,run}=prepare(dir,plan(profiles));
 const promise=supervise(run,{factory:fake('ok',2000)});
 await new Promise(r=>setTimeout(r,100));const receipt=enqueueControl(dir,id,'stop');
 const result=await promise;assert.equal(result.state,'cancelled');assert.equal(controlReceipt(dir,id,receipt.id).state,'applied');
 assert.throws(()=>enqueueControl(dir,id,'steer','x'),/not live/);
});
test('stale owners are interrupted without automatic replay or PID signalling',t=>{
 const {dir,profiles}=fixture(t),{id,run}=prepare(dir,plan(profiles));const state=JSON.parse(readFileSync(join(run,'state.json')));state.heartbeat=Date.now()-20000;state.pid=process.pid;atomicJSON(join(run,'state.json'),state);
 assert.equal(readRun(dir,id).state,'interrupted');assert.throws(()=>resumeSpecification(dir,id,dir),/still exists/);
});
test('host acceptance uses argv, handles exits and strict JSON rather than prose',async t=>{
 const {dir}=fixture(t);
 assert.equal((await checkGate({type:'command',command:process.execPath,args:['-e','process.exit(3)'],timeoutMs:1000},'',dir)).passed,false);
 assert.equal((await checkGate({type:'json',required:[],equals:{verdict:'pass'}},'It passed!',dir)).passed,false);
 assert.equal((await checkGate({type:'command',command:process.execPath,args:['-e','console.log("ok")'],timeoutMs:1000},'',dir)).passed,true);
});
test('managed Git worktree changes stay isolated until explicit integration; dirty cleanup fails',async t=>{
 const {dir}=fixture(t),repo=join(dir,'repo');mkdirSync(repo);await git(repo,['init']);await git(repo,['config','user.email','test@example.invalid']);await git(repo,['config','user.name','Mesh Tests']);writeFileSync(join(repo,'file.txt'),'original\n');await git(repo,['add','.']);await git(repo,['commit','-m','fixture']);
 const workspace=await createWorkspace(dir,repo,'test-workspace');writeFileSync(join(workspace.cwd,'file.txt'),'changed\n');writeFileSync(join(workspace.cwd,'new.txt'),'new\n');assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'original\n');
 assert.match((await workspaceEvidence(dir,workspace)).stat,/new.txt/);await assert.rejects(cleanupWorkspace(dir,workspace),/Unintegrated/);
 const receipt=await mergeWorkspace(dir,workspace);assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'changed\n');assert.equal(readFileSync(join(repo,'new.txt'),'utf8'),'new\n');
 await cleanupWorkspace(dir,workspace,{receipt});assert.equal(existsSync(workspace.path),false);
});
test('multi-lane integration is atomic and preserves whitespace and role notes',async t=>{
 const {dir}=fixture(t),repo=join(dir,'repo');mkdirSync(repo);await git(repo,['init']);await git(repo,['config','user.email','test@example.invalid']);await git(repo,['config','user.name','Mesh Tests']);writeFileSync(join(repo,'base.txt'),'base\n');await git(repo,['add','.']);await git(repo,['commit','-m','fixture']);
 recordHandoff(repo,{identity:'notes',output:'Preserve durable context'});
 const a=await createWorkspace(dir,repo,'lane-a'),b=await createWorkspace(dir,repo,'lane-b');
 a.lane='a';b.lane='b';writeFileSync(join(a.path,'a.txt'),'trailing spaces  \n');writeFileSync(join(b.path,'a.txt'),'overlap\n');
 await assert.rejects(mergeWorkspaces(dir,[a,b]),/Overlapping/);assert.equal(existsSync(join(repo,'a.txt')),false);
 rmSync(join(b.path,'a.txt'));writeFileSync(join(b.path,'b.txt'),'second\n');
 const receipts=await mergeWorkspaces(dir,[a,b]);assert.equal(receipts.length,2);assert.equal(readFileSync(join(repo,'a.txt'),'utf8'),'trailing spaces  \n');assert.equal(readFileSync(join(repo,'b.txt'),'utf8'),'second\n');assert.match(roleMemory(repo,'orchestrator').text,/Preserve durable context/);
});
test('stop settles even when the child ignores abort',async t=>{
 const {dir,profiles}=fixture(t),{id,run}=prepare(dir,plan(profiles));
 const result=supervise(run,{factory:async()=>({messages:[],subscribe:()=>()=>{},prompt:()=>new Promise(()=>{}),abort:()=>new Promise(()=>{}),dispose(){}})});
 await new Promise(r=>setTimeout(r,50));enqueueControl(dir,id,'stop');
 assert.equal((await result).state,'cancelled');
});
test('parallel execution respects concurrency and preserves result ordering',async t=>{
 const {dir,profiles}=fixture(t),{run}=prepare(dir,plan(profiles,{mode:'parallel',concurrency:2,tasks:[1,2,3,4].map(n=>({id:`step-${n}`,profile:'scout',task:String(n)}))}));
 let active=0,max=0;
 const result=await supervise(run,{factory:async task=>{const s=await fake(task.id,10)(),prompt=s.prompt;s.prompt=async()=>{active++;max=Math.max(max,active);try{await prompt()}finally{active--}};return s}});
 assert.equal(max,2);assert.deepEqual(result.steps.map(s=>s.output),['step-1','step-2','step-3','step-4']);
});
test('mission acceptance requires successful linked gate evidence; locking fails busy',t=>{
 const {dir}=fixture(t),mission=updateMission(dir,dir,{objective:'Ship verified changes'});
 assert.throws(()=>updateMission(dir,dir,{id:mission.id,status:'accepted'}),/requires/);
 assert.throws(()=>updateMission(dir,'/another',{id:mission.id,decision:'wrong project'}),/another project/);
 storeLock(dir,'test',()=>assert.throws(()=>storeLock(dir,'test',()=>{}),/EEXIST/));
});
test('schedule is bounded and survives supervisor ownership independent of Pi',async t=>{
 const {dir,profiles}=fixture(t),workflow=plan(profiles,{schedule:{at:new Date().toISOString(),everyMs:60000,maxRuns:2}}),{run}=prepare(dir,workflow);
 let clock=Date.now();const result=await supervise(run,{factory:async(...args)=>{clock+=61000;return fake()(...args)},now:()=>{clock+=61000;return clock}});
 assert.equal(result.completedCycles,2);assert.equal(result.steps.length,2);assert.equal(result.state,'completed');
});
