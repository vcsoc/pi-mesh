import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rename, rm, stat, writeFile, mkdir, realpath } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { launchRun, waitRun } from '../fleet.mjs';
import { compileWorkflow, loadProfiles } from '../workflow.mjs';

const broker=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","broker.mjs");
const port=()=>new Promise((ok,no)=>{const server=net.createServer();server.once("error",no);server.listen(0,"127.0.0.1",()=>{const value=server.address().port;server.close(error=>error?no(error):ok(value))})});
async function wait(url){for(let i=0;i<60;i++){try{const response=await fetch(`${url}/health`);if(response.ok)return await response.json()}catch{}await new Promise(resolve=>setTimeout(resolve,50))}throw new Error("broker timeout")}
async function stop(child){if(child.exitCode!==null)return;await new Promise(done=>{const timer=setTimeout(()=>{child.kill("SIGKILL");done()},3000);child.once("exit",()=>{clearTimeout(timer);done()});child.kill("SIGTERM")})}
const projectHash=value=>createHash("sha256").update(`agent-mesh-project\0${process.platform==="win32"?path.resolve(value).toLocaleLowerCase("en-US"):path.resolve(value)}`).digest("hex");
const registration=value=>({projectHash:projectHash(value.cwd),projectName:path.basename(value.cwd)||"project",...value});
async function fixture(t,{agents,messages,channels}={}){const dir=await mkdtemp(path.join(os.tmpdir(),"mesh-")),p=await port(),token=randomBytes(32).toString("hex"),config=path.join(dir,"config.json"),data=path.join(dir,"data"),base=`http://127.0.0.1:${p}`;await mkdir(data,{recursive:true});await writeFile(config,JSON.stringify({host:"0.0.0.0",port:p,token,dataDir:data}));if(agents)await writeFile(path.join(data,"agents.json"),JSON.stringify(agents));if(channels)await writeFile(path.join(data,'channels.json'),JSON.stringify(channels));if(messages)await writeFile(path.join(data,"messages.jsonl"),messages.map(item=>JSON.stringify(item)).join("\n")+"\n");let child=spawn(process.execPath,[broker,config],{stdio:"ignore"});t.after(async()=>{await stop(child);await rm(dir,{recursive:true,force:true})});const health=await wait(base),headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};const post=async(route,value,custom=headers)=>{const payload=["/api/register","/api/agents/rejoin"].includes(route)?registration(value):value,response=await fetch(`${base}${route}`,{method:"POST",headers:custom,body:JSON.stringify(payload)});return{response,value:await response.json()}};return{dir,data,base,headers,post,health,get child(){return child},set child(value){child=value}}}
function noLegacyFields(value){const text=JSON.stringify(value);for(const field of ["threadId","toAgentId","toName","broadcast"])assert.equal(text.includes(`\"${field}\"`),false,`legacy field leaked: ${field}`)}

test('detached children register roles; parent name reclamation preserves approved background work',async t=>{
 const f=await fixture(t),cwd=await realpath(f.dir),parent=await f.post('/api/register',{agentId:'parent',cwd});assert.equal(parent.response.status,200);
 const plan=compileWorkflow({isolation:'shared',tasks:[{profile:'developer',task:'slow fixture'}]},loadProfiles(cwd,cwd),{activeTools:['read'],currentModel:'fake/model',availableModels:['fake/model']});
 const spec={plan,cwd,project:cwd,projectHash:projectHash(cwd),parentId:'parent',policyDirectory:f.data,mesh:{base:f.base,token:f.headers.Authorization.slice(7)},systemPrompt:'fixture',agentDir:cwd,sdkFile:fileURLToPath(new URL('./fixtures/sdk.mjs',import.meta.url))};
 const run=launchRun(f.data,spec);
 let child;for(let n=0;n<80&&!child;n++){const state=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json());child=state.agents.find(a=>a.id.startsWith('job-'));if(!child)await new Promise(r=>setTimeout(r,50))}
 assert.ok(child);assert.equal(child.name,`${path.basename(cwd)}-dev`);assert.equal(child.role,'developer');
 assert.equal(child.parentAgentId,'parent');assert.equal(child.runId,run.id);assert.ok(child.taskId);
 const intervention=await f.post('/api/user/messages',{to:child.id,content:'Scope refinement for fixture'});assert.equal(intervention.response.status,201);
 await f.post('/api/offline',{agentId:'parent'});const replacement=await f.post('/api/register',{agentId:'replacement',cwd});assert.equal(replacement.value.agent.name,parent.value.agent.name);
 const completed=await waitRun(f.data,run.id,{timeoutMs:10000});assert.equal(completed.state,'completed','offline name reuse must not revoke durable grants');
 assert.ok(completed.inboxDeliveries.some(item=>item.messageId===intervention.value.message.id));
 assert.match(await readFile(completed.steps[0].sessionFile,'utf8'),/Scope refinement for fixture/);
 const after=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json()),reply=after.messages.find(m=>m.fromAgentId===child.id);
 assert.equal(reply.destination.name,'user');assert.deepEqual(reply.recipientAgentIds,[]);
 const second=launchRun(f.data,{...spec,parentId:'replacement'});let active;
 for(let n=0;n<80&&!active;n++){const state=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json());active=state.agents.find(a=>a.id.startsWith(`job-${second.id}`));if(!active)await new Promise(r=>setTimeout(r,50))}
 assert.ok(active);await f.post('/api/agents/toggle',{agentId:active.id,enabled:false});
 assert.equal((await waitRun(f.data,second.id,{timeoutMs:10000})).state,'cancelled','explicit child disable revokes execution');
});
test('worker lineage is public, persistent and cannot point across project identities',async t=>{
 const f=await fixture(t);await f.post('/api/register',{agentId:'parent',cwd:'/fixture/one'});await f.post('/api/register',{agentId:'other',cwd:'/fixture/two'});
 const worker={agentId:'job-run-fixture-task',parentAgentId:'parent',runId:'run-fixture',taskId:'task',role:'reviewer',cwd:'/fixture/one'};
 const registered=await f.post('/api/register',worker);assert.equal(registered.response.status,200);assert.equal(registered.value.agent.parentAgentId,'parent');assert.equal(registered.value.agent.runId,'run-fixture');
 const repeat=await f.post('/api/register',{agentId:worker.agentId,cwd:worker.cwd});assert.equal(repeat.value.agent.parentAgentId,'parent');
 assert.equal((await f.post('/api/register',{...worker,agentId:'job-run-fixture-bad',parentAgentId:'other'})).response.status,409);
 assert.equal((await f.post('/api/register',{...worker,agentId:'ordinary-session'})).response.status,409);
 const persisted=JSON.parse(await readFile(path.join(f.data,'agents.json'),'utf8'));assert.equal(persisted[worker.agentId].taskId,'task');
 const asset=await fetch(f.base+'/topology-layout.mjs',{headers:f.headers});assert.equal(asset.status,200);assert.match(await asset.text(),/neighbourhoodLayout/);
});
test('recognizable legacy default names migrate but deliberate custom names survive',async t=>{
 const cwd='/tmp/mypi',f=await fixture(t,{agents:{abcde:{id:'abcde',name:'mypi-abcde',cwd,status:'idle',lastSeenAt:Date.now(),channels:['general']},custom:{id:'custom',name:'My Chosen Name',cwd,status:'idle',lastSeenAt:Date.now(),channels:['general']}}});
 assert.equal((await f.post('/api/register',{agentId:'abcde',cwd})).value.agent.name,'mypi-orc');
 assert.equal((await f.post('/api/register',{agentId:'custom',cwd})).value.agent.name,'My Chosen Name');
});
test('automatic role names, online suffixing and offline reclamation preserve immutable history',async t=>{
 const f=await fixture(t),cwd='/tmp/mypi';
 const register=(agentId,role)=>f.post('/api/register',{agentId,role,cwd});
 assert.equal((await register('orc')).value.agent.name,'mypi-orc');
 assert.equal((await register('dev','developer')).value.agent.name,'mypi-dev');
 assert.equal((await register('dev1','worker')).value.agent.name,'mypi-dev1');
 const sent=await f.post('/api/agent/messages',{agentId:'dev',to:'#user',content:'Original evidence'});assert.equal(sent.value.message.fromName,'mypi-dev');
 await f.post('/api/offline',{agentId:'dev'});
 const replacement=await register('new-dev','developer');assert.equal(replacement.value.agent.name,'mypi-dev');
 assert.equal((await f.post('/api/heartbeat',{agentId:'dev',status:'working'})).response.status,410);
 const state=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json());assert.equal(state.messages[0].fromName,'mypi-dev');assert.equal(state.agents.some(a=>a.id==='dev'),false);
 assert.equal((await register('rev','reviewer')).value.agent.name,'mypi-rev');
 assert.equal((await f.post('/api/agents/role',{agentId:'rev',role:'architect'})).value.agent.name,'mypi-arch');
 assert.equal((await f.post('/api/agents/rejoin',{agentId:'dev',cwd})).value.agent.name,'mypi-dev2','rejoining an old role cannot take an online holder');
});
test('project channel names are stable, isolate duplicate folders and migrate hashed history',async t=>{
 const cwd='/mesh-tests/app',hash=projectHash(cwd),legacy=`project-app-${hash.slice(0,12)}`,record={id:1,messageId:'old',timestamp:'2026-01-01',fromAgentId:'a',fromName:'A',fromType:'agent',scopeChannel:legacy,destination:{type:'channel',name:legacy,id:legacy},recipientAgentIds:['b'],content:'Preserve historical evidence',kind:'message'};
 const f=await fixture(t,{agents:{a:{id:'a',name:'A',cwd:cwd+'/removed-subfolder',projectHash:hash,projectName:'app',channels:[legacy],activeChannel:legacy,lastAck:0},b:{id:'b',name:'B',cwd,channels:[legacy],activeChannel:legacy,lastAck:0}},channels:{[legacy]:{name:legacy,createdBy:'system'}},messages:[record]});
 const state=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json());assert.equal(state.agents.find(a=>a.id==='a').activeChannel,'app');assert.ok(state.channels.find(c=>c.name==='app').aliases.includes(legacy));assert.equal(state.channels.some(c=>c.name===legacy),false);assert.deepEqual(state.messages[0],record);
 assert.equal((await f.post('/api/register',{agentId:'new',cwd})).value.agent.activeChannel,'app');
 const other=await f.post('/api/register',{agentId:'other',cwd:'/different/app'});assert.notEqual(other.value.agent.activeChannel,'app');
 const history=await fetch(f.base+'/api/messages?channel=app',{headers:f.headers}).then(r=>r.json());assert.equal(history.messages[0].content,record.content);
 const pending=await fetch(f.base+'/api/inbox?agentId=b',{headers:f.headers}).then(r=>r.json());assert.equal(pending.messages[0].id,1,'renaming preserves pending delivery within the same scope');
 const oldAlias=await f.post('/api/channels/switch',{agentId:'a',channel:legacy});assert.equal(oldAlias.value.agent.activeChannel,'app');
 const config=path.join(f.dir,'config.json');await stop(f.child);f.child=spawn(process.execPath,[broker,config],{stdio:'ignore'});await wait(f.base);
 assert.equal((await f.post('/api/register',{agentId:'third',cwd})).value.agent.activeChannel,'app');
 assert.equal((await readFile(path.join(f.data,'messages.jsonl'),'utf8')).trim(),JSON.stringify(record));
 await f.post('/api/channels/close',{channel:'app'});assert.equal((await f.post('/api/channels/switch',{agentId:'a',channel:legacy})).response.status,410,'old aliases cannot bypass channel closure');
 assert.equal((await f.post('/api/register',{agentId:'fourth',cwd})).value.agent.activeChannel,'app-2','explicit closure creates a new readable namespace, never reopens history');
});
test('security policy drafts require authentication, validation, confirmation and a current revision without enabling enforcement',async t=>{
 const f=await fixture(t);assert.equal((await fetch(f.base+'/api/security/draft')).status,401);
 const original=await fetch(f.base+'/api/security/draft',{headers:f.headers}).then(r=>r.json());assert.equal(original.canApply,false);assert.equal(original.revision,null);
 assert.equal((await f.post('/api/security/validate',{scope:'',markdown:original.markdown},{...f.headers,Origin:'https://evil.invalid'})).response.status,403);
 assert.equal((await f.post('/api/security/validate',{scope:'unknown',markdown:original.markdown})).response.status,400);
 assert.equal((await f.post('/api/security/validate',{scope:'',markdown:'not policy'})).response.status,400);
 assert.equal((await f.post('/api/security/draft',{scope:'',markdown:original.markdown,baseRevision:null})).response.status,400);
 const saved=await f.post('/api/security/draft',{scope:'',markdown:original.markdown,baseRevision:null,confirm:true});assert.equal(saved.response.status,200);assert.equal(saved.value.draftOnly,true);assert.equal(saved.value.enforcement,'not-integrated');
 assert.equal((await f.post('/api/security/draft',{scope:'',markdown:original.markdown,baseRevision:null,confirm:true})).response.status,409);
 const state=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json());assert.deepEqual(state.policy,{enabled:true,blockedProjects:[],blockedProjectNames:{}});
});
test('agent model/thinking requests are queued, acknowledged by the target, and reject stale or immutable jobs',async t=>{
 const f=await fixture(t),cwd='/tmp/mesh-config';
 const registered=await f.post('/api/register',{agentId:'a',cwd,model:'fake/model',thinkingLevel:'off',configSupport:true,modelCatalog:[{id:'fake/model',levels:['off','low']}]});assert.equal(registered.response.status,200);
 const catalog=await fetch(f.base+'/api/agents/config?agentId=a&catalog=1',{headers:f.headers}).then(r=>r.json());assert.deepEqual(catalog.models,[{id:'fake/model',levels:['off','low']}]);assert.equal(catalog.request,null);
 assert.equal((await fetch(f.base+'/api/agents/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentId:'a',thinkingLevel:'low'})})).status,401);
 assert.equal((await f.post('/api/agents/config',{agentId:'a',thinkingLevel:'low'},{...f.headers,Origin:'https://other.invalid'})).response.status,403);
 assert.equal((await f.post('/api/agents/config',{agentId:'a',model:'not-exact'})).response.status,400);
 assert.equal((await f.post('/api/agents/config',{agentId:'a',model:'unknown/model'})).response.status,400);
 assert.equal((await f.post('/api/agents/config',{agentId:'a',thinkingLevel:'high'})).response.status,400);
 assert.equal((await f.post('/api/agents/config',{agentId:'a',generation:999,thinkingLevel:'low'})).response.status,409);
 const queued=await f.post('/api/agents/config',{agentId:'a',model:'fake/model',thinkingLevel:'low'});assert.equal(queued.response.status,202);assert.equal((await f.post('/api/agents/config',{agentId:'a',thinkingLevel:'high'})).response.status,409);
 await stop(f.child);f.child=spawn(process.execPath,[broker,path.join(f.dir,'config.json')],{stdio:'ignore'});await wait(f.base);
 const persisted=await fetch(f.base+'/api/agents/config?agentId=a',{headers:f.headers}).then(r=>r.json());assert.equal(persisted.request.id,queued.value.request.id,'pending configuration survives broker restart');
 assert.equal((await f.post('/api/agents/config/ack',{agentId:'a',requestId:'wrong',state:'applied',model:'fake/model',thinkingLevel:'low'})).response.status,409);
 const applied=await f.post('/api/agents/config/ack',{agentId:'a',requestId:queued.value.request.id,state:'applied',model:'fake/model',thinkingLevel:'low'});assert.equal(applied.value.agent.thinkingLevel,'low');assert.equal(applied.value.agent.configuration.state,'applied');
 assert.equal((await f.post('/api/agents/config/ack',{agentId:'a',requestId:queued.value.request.id,state:'applied',model:'fake/model',thinkingLevel:'low'})).response.status,409);
 await f.post('/api/register',{agentId:'job-fixed',cwd,model:'fake/model',configSupport:true});assert.equal((await f.post('/api/agents/config',{agentId:'job-fixed',thinkingLevel:'low'})).response.status,409);
 await f.post('/api/offline',{agentId:'a'});assert.equal((await f.post('/api/agents/config',{agentId:'a',thinkingLevel:'low'})).response.status,409);
});
test('fleet routes are authenticated, read-only on GET and reject traversal/control forgery',async t=>{
 const f=await fixture(t);
 assert.equal((await fetch(f.base+'/api/fleet')).status,401);
 const list=await fetch(f.base+'/api/fleet',{headers:f.headers}).then(r=>r.json());assert.deepEqual(list.runs,[]);
 assert.equal((await f.post('/api/fleet/control',{id:'../../policy.json',action:'stop'})).response.status,400);
 assert.equal((await f.post('/api/fleet/control',{id:'anything',action:'run'})).response.status,400);
 assert.equal((await f.post('/api/fleet/control',{id:'anything',action:'stop'},{...f.headers,Origin:'https://evil.invalid'})).response.status,403);
 assert.equal((await fetch(f.base+'/fleet-panel.js',{headers:f.headers})).status,200);
});
test("v2 channels, recipient snapshots, security, UI assets, and persistence",async t=>{
 const f=await fixture(t);assert.equal(f.health.version,"2.8.1");assert.equal(f.health.host,"127.0.0.1");assert.ok(f.health.instance);
 for(const agent of [{agentId:"cubed",requestedName:"Cubed",cwd:"C:/cubed",status:"idle"},{agentId:"haven",requestedName:"Haven",cwd:"C:/haven",status:"working"}])assert.equal((await f.post("/api/register",agent)).response.status,200);
 assert.equal((await f.post("/api/register",{agentId:"x",requestedName:"Haven",cwd:"C:/x"})).response.status,409);
 let state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.channels.find(channel=>channel.name==="user").memberCount,2);assert.equal(state.agents.find(agent=>agent.id==="cubed").activeChannel,'cubed');
 const joined=await f.post("/api/channels/join",{agentId:"cubed",channels:["channel1","channel2","channel3"]});assert.equal(joined.response.status,200);assert.deepEqual(joined.value.changed,["channel1","channel2","channel3"]);assert.equal((await f.post("/api/channels/join",{agentId:"cubed",channels:["channel1"]})).value.changed.length,0);await f.post("/api/channels/join",{agentId:"haven",channels:["channel1"]});
 const sent=await f.post("/api/agent/messages",{agentId:"cubed",to:"#channel1",kind:"question",content:"Define the API contract."});assert.equal(sent.response.status,201);assert.equal(sent.value.message.destination.type,"channel");assert.equal(sent.value.message.destination.name,"channel1");assert.deepEqual(sent.value.message.recipientAgentIds,["haven"]);noLegacyFields(sent.value.message);
 await f.post("/api/channels/leave",{agentId:"haven",channels:["channel1"]});let inbox=await fetch(`${f.base}/api/inbox?agentId=haven`,{headers:f.headers}).then(response=>response.json());assert.equal(inbox.messages.length,0,"leaving a channel revokes pending delivery from that channel");await f.post("/api/ack",{agentId:"haven",messageId:sent.value.message.id});assert.equal((await f.post("/api/agent/messages",{agentId:"cubed",to:"#channel1",content:"Nobody else is joined."})).response.status,409);
 await f.post("/api/channels/join",{agentId:"haven",channels:["channel1"]});const channelUser=await f.post("/api/user/messages",{to:"#channel1",kind:"steer",content:"Coordinate first."});assert.equal(channelUser.response.status,201);assert.deepEqual(channelUser.value.message.recipientAgentIds,["cubed","haven"]);const kicked=await f.post("/api/channels/kick",{agentId:"haven",channels:["channel1"]});assert.equal(kicked.response.status,200);assert.deepEqual(kicked.value.changed,["channel1"]);inbox=await fetch(`${f.base}/api/inbox?agentId=haven`,{headers:f.headers}).then(response=>response.json());assert.equal(inbox.messages.some(message=>message.id===channelUser.value.message.id),false,"kick discards pending channel delivery through its high-water mark");await f.post("/api/channels/join",{agentId:"haven",channels:["channel1"]});const afterKick=await f.post("/api/user/messages",{to:"#channel1",content:"After rejoin."});inbox=await fetch(`${f.base}/api/inbox?agentId=haven`,{headers:f.headers}).then(response=>response.json());assert.equal(inbox.messages.some(message=>message.id===afterKick.value.message.id),true);
 const direct=await f.post("/api/user/messages",{to:"Cubed",kind:"steer",content:"Direct steering."});assert.equal(direct.value.message.destination.type,"agent");assert.deepEqual(direct.value.message.recipientAgentIds,["cubed"]);inbox=await fetch(`${f.base}/api/inbox?agentId=cubed`,{headers:f.headers}).then(response=>response.json());assert.equal(inbox.messages.some(message=>message.id===direct.value.message.id),true);
 const all=await f.post("/api/agent/messages",{agentId:"cubed",to:"*",kind:"status",content:"Global update."});assert.equal(all.value.message.destination.type,"all");assert.deepEqual(all.value.message.recipientAgentIds,["haven"]);
 const notMember=await f.post("/api/agent/messages",{agentId:"haven",to:"#channel2",content:"not allowed"});assert.equal(notMember.response.status,403);assert.equal(notMember.value.error.code,"CHANNEL_MEMBERSHIP_REQUIRED");const removed=await f.post("/api/agents/remove",{agentId:"haven"});assert.equal(removed.response.status,200);state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.agents.some(agent=>agent.id==="haven"),false);assert.equal((await f.post("/api/heartbeat",{agentId:"haven",status:"idle"})).response.status,410);assert.equal((await f.post("/api/register",{agentId:"haven",requestedName:"Haven",cwd:"/haven"})).response.status,410);const duringRemoval=await f.post("/api/agent/messages",{agentId:"cubed",to:"*",content:"While removed."});assert.equal(duringRemoval.value.message.recipientAgentIds.includes("haven"),false);const rejoined=await f.post("/api/agents/rejoin",{agentId:"haven",cwd:"C:/haven",status:"idle"});assert.equal(rejoined.response.status,200);assert.deepEqual(rejoined.value.agent.channels,[]);assert.equal(rejoined.value.agent.name,"Haven");assert.ok(rejoined.value.agent.lastAck>=duringRemoval.value.message.id);await f.post("/api/channels/join",{agentId:"haven",channels:["channel1"]});const pendingClosed=await f.post("/api/user/messages",{to:"#channel2",content:"Pending before close."});assert.equal(pendingClosed.response.status,201);const closed=await f.post("/api/channels/close",{channel:"channel2"});assert.equal(closed.response.status,200);state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.channels.some(channel=>channel.name==="channel2"),false);assert.equal(state.agents.find(agent=>agent.id==="cubed").channels.includes("channel2"),false);inbox=await fetch(`${f.base}/api/inbox?agentId=cubed`,{headers:f.headers}).then(response=>response.json());assert.equal(inbox.messages.some(message=>message.id===pendingClosed.value.message.id),false);assert.equal((await f.post("/api/user/messages",{to:"#channel2",content:"closed"})).response.status,410);assert.equal((await f.post("/api/channels/join",{agentId:"cubed",channels:["channel2"]})).response.status,410);const closedAgain=await f.post("/api/channels/close",{channel:"channel2"});assert.equal(closedAgain.response.status,200);assert.equal(closedAgain.value.changed,false);assert.equal((await f.post("/api/channels/close",{channel:"user"})).response.status,409);
 assert.equal((await fetch(`${f.base}/api/state`)).status,401);assert.equal((await f.post("/api/user/messages",{to:"Cubed",content:"bad"},{...f.headers,Origin:"https://evil.example"})).response.status,403);const plain=await fetch(`${f.base}/api/user/messages`,{method:"POST",headers:{Authorization:f.headers.Authorization,"Content-Type":"text/plain"},body:"bad"});assert.equal(plain.status,415);const arrayBody=await fetch(`${f.base}/api/user/messages`,{method:"POST",headers:f.headers,body:"[]"});assert.equal(arrayBody.status,400);const oversized=await fetch(`${f.base}/api/user/messages`,{method:"POST",headers:f.headers,body:JSON.stringify({to:"Cubed",content:"x".repeat(70*1024)})});assert.equal(oversized.status,413);
 const auth=await fetch(`${f.base}/auth/help?token=${f.headers.Authorization.slice(7)}`,{redirect:"manual"});assert.equal(auth.status,302);assert.equal(auth.headers.get("location"),"/help");assert.match(auth.headers.get("set-cookie"),/HttpOnly.*SameSite=Strict/i);const cookie=auth.headers.get("set-cookie").split(";",1)[0],dashboard=await fetch(f.base,{headers:{Cookie:cookie}});assert.equal(dashboard.status,200);const dashboardHtml=await dashboard.text();assert.match(dashboardHtml,/Channels/);assert.match(dashboardHtml,/Membership/);assert.ok(dashboardHtml.indexOf('id="composer"')<dashboardHtml.indexOf('id="membership"'),"membership controls follow Intervene");assert.match(dashboardHtml,/id="topology-canvas"/);assert.match(dashboardHtml,/id="message-tabs"/);assert.match(dashboardHtml,/id="matrix-panel"/);assert.match(dashboardHtml,/Developed by Chris Visser/);assert.match(dashboardHtml,/https:\/\/github.com\/vcsoc/);assert.match(dashboardHtml,/Remove agent from mesh/);assert.match(dashboardHtml,/Kick from channel/);assert.match(dashboardHtml,/context-menu/);assert.doesNotMatch(dashboardHtml,/Thread ID/);const dashboardCss=await fetch(`${f.base}/dashboard.css`,{headers:{Cookie:cookie}}).then(response=>response.text());assert.match(dashboardCss,/grid-template-rows:auto minmax\(0,1fr\) auto/);assert.match(dashboardCss,/--bg:#101012/);assert.match(dashboardCss,/\.topology-node\.working\{background:#226b3a/);assert.match(dashboardCss,/\.topology-node\.idle\{background:#9a5016/);assert.match(dashboardCss,/\.topology-node\.offline\{background:#505056/);assert.match(dashboardCss,/\.context\{display:grid;[^}]*overflow:hidden/);assert.match(dashboardCss,/\.context-panel\{display:flex;[^}]*min-height:0;overflow:hidden/);assert.match(dashboardCss,/\.threads,\.people\{overflow:auto/);assert.match(dashboardCss,/\.context-menu\{position:fixed/);const dashboardJs=await fetch(`${f.base}/dashboard.js`,{headers:{Cookie:cookie}}).then(response=>response.text());assert.match(dashboardJs,/changeMembership/);assert.match(dashboardJs,/removeAgentFromMesh/);assert.match(dashboardJs,/showContextMenu/);assert.match(dashboardJs,/closeChannel/);assert.match(dashboardJs,/contextmenu/);assert.doesNotMatch(dashboardJs,/\bconfirm\s*\(/);assert.match(dashboardJs,/api\/channels\/\$\{action\}/);assert.match(dashboardJs,/destination\.type/);assert.doesNotMatch(dashboardJs,/threadId/);const help=await fetch(`${f.base}/help`,{headers:{Cookie:cookie}});assert.equal(help.status,200);assert.match(await help.text(),/Start the Agent Mesh walkthrough/);const unsafeNext=await fetch(`${f.base}/auth?token=${f.headers.Authorization.slice(7)}&next=${encodeURIComponent("https://evil.example")}`,{redirect:"manual"});assert.equal(unsafeNext.headers.get("location"),"/");
 state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());noLegacyFields(state);const exported=await fetch(`${f.base}/api/export`,{headers:f.headers}).then(response=>response.text());for(const line of exported.trim().split(/\r?\n/))noLegacyFields(JSON.parse(line));
 if(process.platform!=="win32"){for(const name of ["agents.json","channels.json","policy.json","messages.jsonl"])assert.equal((await stat(path.join(f.data,name))).mode&0o777,0o600)}
 await stop(f.child);await rename(path.join(f.data,"agents.json"),path.join(f.data,"agents.json.bak"));f.child=spawn(process.execPath,[broker,path.join(f.dir,"config.json")],{stdio:"ignore"});await wait(f.base);const recovered=await fetch(`${f.base}/api/agents`,{headers:f.headers}).then(response=>response.json());assert.equal(recovered.agents.length,2);assert.ok(recovered.agents.find(agent=>agent.id==="cubed").channels.includes("channel3"));
});

test("agents can only coordinate with peers in their current channels",async t=>{
 const f=await fixture(t);for(const agent of [{agentId:"agent-a",requestedName:"Agent A",cwd:"/projects/a",status:"idle"},{agentId:"agent-b",requestedName:"Agent B",cwd:"/projects/b",status:"idle"},{agentId:"agent-y",requestedName:"Agent Y",cwd:"/projects/y",status:"idle"}])assert.equal((await f.post("/api/register",agent)).response.status,200);
 for(const agentId of ['agent-a','agent-b']) await f.post('/api/channels/join',{agentId,channels:['shared-work']});await f.post("/api/channels/join",{agentId:"agent-y",channels:["sample-22"]});
 let scoped=await fetch(`${f.base}/api/agents?agentId=agent-a`,{headers:f.headers}).then(response=>response.json());assert.deepEqual(scoped.agents.map(agent=>agent.id),["agent-b"]);
 assert.equal((await f.post("/api/agent/messages",{agentId:"agent-a",to:"agent-y",content:"out of scope"})).value.error.code,"NO_SHARED_CHANNEL");const generalMessage=await f.post("/api/user/messages",{to:"#shared-work",content:"pending general"});const pendingDirect=await f.post("/api/agent/messages",{agentId:"agent-b",to:"agent-a",content:"pending direct"});
 let broadcast=await f.post("/api/agent/messages",{agentId:"agent-a",to:"*",content:"general only"});assert.deepEqual(broadcast.value.message.recipientAgentIds,["agent-b"]);
 await f.post("/api/channels/leave",{agentId:"agent-a",channels:["shared-work"]});await f.post("/api/channels/join",{agentId:"agent-a",channels:["sample-22"]});
 const inboxAfterLeave=await fetch(`${f.base}/api/inbox?agentId=agent-a`,{headers:f.headers}).then(response=>response.json());assert.equal(inboxAfterLeave.messages.some(message=>[generalMessage.value.message.id,pendingDirect.value.message.id].includes(message.id)),false,"leaving the shared channel revokes pending channel and peer delivery");
 assert.equal((await f.post("/api/agent/messages",{agentId:"agent-a",to:"agent-b",content:"no longer shared"})).value.error.code,"NO_SHARED_CHANNEL");const direct=await f.post("/api/agent/messages",{agentId:"agent-a",to:"agent-y",content:"sample peer"});assert.equal(direct.response.status,201);broadcast=await f.post("/api/agent/messages",{agentId:"agent-a",to:"*",content:"sample only"});assert.deepEqual(broadcast.value.message.recipientAgentIds,["agent-y"]);
 const scopedUserDenied=await f.post("/api/user/messages",{originAgentId:"agent-a",to:"agent-b",content:"denied"});assert.equal(scopedUserDenied.response.status,201,'user interventions cross project scope');const scopedUser=await f.post("/api/user/messages",{originAgentId:"agent-a",to:"agent-y",content:"allowed"});assert.equal(scopedUser.response.status,201);assert.equal(scopedUser.value.message.fromType,"user");assert.equal(scopedUser.value.message.scopeAgentId,"agent-a");assert.equal((await f.post("/api/user/messages",{to:"agent-b",content:"dashboard remains authoritative"})).response.status,201);
 scoped=await fetch(`${f.base}/api/agents?agentId=agent-a`,{headers:f.headers}).then(response=>response.json());assert.deepEqual(scoped.agents.map(agent=>agent.id),["agent-y"]);const sampleChannel=await f.post("/api/agent/messages",{agentId:"agent-a",to:"#sample-22",content:"sample channel"});assert.equal(sampleChannel.response.status,201);const history=await fetch(`${f.base}/api/messages?agentId=agent-a&limit=250`,{headers:f.headers}).then(response=>response.json());assert.equal(history.messages.some(message=>message.id===generalMessage.value.message.id),true,'user interventions remain visible to their recipients');assert.equal(history.messages.some(message=>message.id===sampleChannel.value.message.id),true);
});

test("persistent global, participant, and project controls are server enforced",async t=>{
 const f=await fixture(t),alpha=registration({agentId:"alpha",requestedName:"Alpha",cwd:"/projects/alpha",status:"idle"}),beta=registration({agentId:"beta",requestedName:"Beta",cwd:"/projects/beta",status:"working"});
 assert.equal((await f.post("/api/register",alpha)).response.status,200);assert.equal((await f.post("/api/register",beta)).response.status,200);
 let state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.deepEqual(state.policy,{enabled:true,blockedProjects:[],blockedProjectNames:{}});assert.equal(state.agents.find(item=>item.id==="alpha").projectName,"alpha");assert.equal(state.agents.find(item=>item.id==="alpha").projectHash,alpha.projectHash);
 assert.equal((await f.post("/api/policy/global",{enabled:false})).response.status,200);
 for(const [route,value] of [["/api/heartbeat",{agentId:"alpha",status:"idle"}],["/api/agent/messages",{agentId:"alpha",to:"*",content:"blocked"}],["/api/ack",{agentId:"alpha",messageId:1}],["/api/channels/join",{agentId:"alpha",channels:["blocked"]}],["/api/rename",{agentId:"alpha",name:"Blocked Alpha"}],["/api/user/messages",{to:"Alpha",content:"blocked"}]]){const result=await f.post(route,value);assert.equal(result.response.status,403,route);assert.equal(result.value.error.code,"MESH_DISABLED",route)}
 let inboxResponse=await fetch(`${f.base}/api/inbox?agentId=alpha`,{headers:f.headers});assert.equal(inboxResponse.status,403);assert.equal((await inboxResponse.json()).error.code,"MESH_DISABLED");let channelsResponse=await fetch(`${f.base}/api/channels?agentId=alpha`,{headers:f.headers});assert.equal(channelsResponse.status,403);assert.equal((await channelsResponse.json()).error.code,"MESH_DISABLED");
 const dormant=registration({agentId:"dormant",requestedName:"Dormant",cwd:"/projects/dormant",status:"idle"}),dormantRegistration=await f.post("/api/register",dormant);assert.equal(dormantRegistration.response.status,403);assert.equal(dormantRegistration.value.error.code,"MESH_DISABLED");state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.ok(state.agents.some(item=>item.id==="dormant"),"disabled first registration persists identity");
 assert.equal((await f.post("/api/agents/leave",{agentId:"alpha"})).response.status,200);const failedGlobalRejoin=await f.post("/api/agents/rejoin",alpha);assert.equal(failedGlobalRejoin.response.status,403);assert.equal(failedGlobalRejoin.value.error.code,"MESH_DISABLED");state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.agents.some(item=>item.id==="alpha"),false,"failed rejoin does not reactivate the agent");
 await f.post("/api/policy/global",{enabled:true});assert.equal((await f.post("/api/agents/rejoin",alpha)).response.status,200,"rejoin succeeds after policy recovery without reload");assert.equal((await f.post("/api/heartbeat",{agentId:"dormant",status:"idle"})).response.status,200,"heartbeat recovers persisted registration");const spoofedRegister=await f.post("/api/register",{...alpha,cwd:beta.cwd,projectHash:beta.projectHash});assert.equal(spoofedRegister.response.status,409);assert.equal(spoofedRegister.value.error.code,"PROJECT_IDENTITY_MISMATCH");
 await f.post("/api/agents/toggle",{agentId:"alpha",enabled:false});
 for(const [route,value] of [["/api/register",alpha],["/api/heartbeat",{agentId:"alpha",status:"idle"}],["/api/agent/messages",{agentId:"alpha",to:"*",content:"blocked"}],["/api/ack",{agentId:"alpha",messageId:1}],["/api/channels/leave",{agentId:"alpha",channels:["general"]}],["/api/rename",{agentId:"alpha",name:"Blocked Alpha"}]]){const result=await f.post(route,value);assert.equal(result.response.status,403,route);assert.equal(result.value.error.code,"AGENT_DISABLED",route)}
 inboxResponse=await fetch(`${f.base}/api/inbox?agentId=alpha`,{headers:f.headers});assert.equal(inboxResponse.status,403);assert.equal((await inboxResponse.json()).error.code,"AGENT_DISABLED");channelsResponse=await fetch(`${f.base}/api/channels?agentId=alpha`,{headers:f.headers});assert.equal(channelsResponse.status,403);assert.equal((await channelsResponse.json()).error.code,"AGENT_DISABLED");const directDisabled=await f.post("/api/user/messages",{to:"Alpha",content:"blocked"});assert.equal(directDisabled.response.status,403);assert.equal(directDisabled.value.error.code,"AGENT_DISABLED");
 assert.equal((await f.post("/api/agents/leave",{agentId:"alpha"})).response.status,200,"voluntary leave remains available while disabled");await f.post("/api/agents/toggle",{agentId:"alpha",enabled:true});const spoofedRejoin=await f.post("/api/agents/rejoin",{...alpha,cwd:beta.cwd,projectHash:beta.projectHash});assert.equal(spoofedRejoin.response.status,409);assert.equal(spoofedRejoin.value.error.code,"PROJECT_IDENTITY_MISMATCH");assert.equal((await f.post("/api/agents/rejoin",alpha)).response.status,200);
 await f.post("/api/projects/toggle",{projectHash:alpha.projectHash,blocked:true});const projectBlocked=await f.post("/api/heartbeat",{agentId:"alpha",status:"idle"});assert.equal(projectBlocked.response.status,403);assert.equal(projectBlocked.value.error.code,"PROJECT_BLOCKED");const projectDirect=await f.post("/api/user/messages",{to:"Alpha",content:"blocked"});assert.equal(projectDirect.response.status,403);assert.equal(projectDirect.value.error.code,"PROJECT_BLOCKED");const broadcast=await f.post("/api/agent/messages",{agentId:"beta",to:"*",content:"eligible only"});assert.equal(broadcast.value.message.recipientAgentIds.includes("alpha"),false);
 const shadow={...registration({agentId:"shadow",requestedName:"Shadow",cwd:"/projects/alpha",status:"idle"}),projectHash:alpha.projectHash,projectName:"alpha"},shadowRegistration=await f.post("/api/register",shadow);assert.equal(shadowRegistration.response.status,403);assert.equal(shadowRegistration.value.error.code,"PROJECT_BLOCKED");state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.deepEqual(state.policy.blockedProjects,[alpha.projectHash]);assert.equal(state.policy.blockedProjectNames[alpha.projectHash],"alpha");assert.equal(JSON.parse(await readFile(path.join(f.data,"policy.json"),"utf8")).blockedProjectNames[alpha.projectHash],"alpha");assert.equal(state.agents.find(item=>item.id==="shadow").effectiveEnabled,false);
 await f.post("/api/projects/toggle",{projectHash:alpha.projectHash,blocked:false});assert.equal((await f.post("/api/heartbeat",{agentId:"alpha",status:"idle"})).response.status,200);assert.equal((await f.post("/api/heartbeat",{agentId:"shadow",status:"idle"})).response.status,200,"future blocked registration recovers after unblock");
 await f.post("/api/policy/global",{enabled:false});await stop(f.child);f.child=spawn(process.execPath,[broker,path.join(f.dir,"config.json")],{stdio:"ignore"});await wait(f.base);state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.policy.enabled,false,"global policy survives restart");await f.post("/api/policy/global",{enabled:true});
 await f.post("/api/offline",{agentId:"alpha"});const offlineKick=await f.post("/api/agents/kick-all",{status:"offline"});assert.deepEqual(offlineKick.value.removed.map(item=>item.id),["alpha"]);const workingKick=await f.post("/api/agents/kick-all",{status:"working"});assert.deepEqual(workingKick.value.removed.map(item=>item.id),["beta"]);const onlineKick=await f.post("/api/agents/kick-all",{status:"online"});assert.deepEqual(onlineKick.value.removed.map(item=>item.id).sort(),["dormant","shadow"]);assert.equal((await f.post("/api/agents/kick-all",{status:"all"})).value.count,0);
});

test("forced rename disconnects the previous name holder and transfers the name",async t=>{
 const f=await fixture(t);await f.post("/api/register",{agentId:"owner",requestedName:"Taken Name",cwd:"/owner",status:"working"});await f.post("/api/register",{agentId:"requester",requestedName:"Requester",cwd:"/requester",status:"idle"});const refused=await f.post("/api/rename",{agentId:"requester",name:"Taken Name"});assert.equal(refused.response.status,409);assert.equal(refused.value.error.code,"AGENT_NAME_TAKEN");const forced=await f.post("/api/rename",{agentId:"requester",name:"Taken Name -f"});assert.equal(forced.response.status,200);assert.equal(forced.value.agent.name,"Taken Name");assert.equal(forced.value.displaced.id,"owner");assert.equal(forced.value.displaced.name,"Taken Name");let state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.agents.length,1);assert.equal(state.agents[0].id,"requester");assert.equal((await f.post("/api/heartbeat",{agentId:"owner",status:"idle"})).response.status,410);const rejoined=await f.post("/api/agents/rejoin",{agentId:"owner",cwd:"/owner",status:"idle"});assert.equal(rejoined.response.status,200);assert.match(rejoined.value.agent.name,/^Disconnected-[a-f0-9]{12}$/);assert.notEqual(rejoined.value.agent.name,"Taken Name");
});

test("v1 message fixtures migrate to v2 channel destinations without legacy fields",async t=>{
 const registeredAt=new Date(Date.now()-10000).toISOString(),agents={cubed:{id:"cubed",name:"Cubed",cwd:"/cubed",status:"offline",registeredAt,lastSeenAt:0,lastAck:0},haven:{id:"haven",name:"Haven",cwd:"/haven",status:"offline",registeredAt,lastSeenAt:0,lastAck:0}};
 const messages=[{id:1,messageId:"old-1",threadId:"Release Scope",timestamp:new Date().toISOString(),fromType:"agent",fromAgentId:"cubed",fromName:"Cubed",toAgentId:"haven",toName:"Haven",broadcast:false,kind:"question",content:"Legacy direct"},{id:2,messageId:"old-2",threadId:"Release Scope",timestamp:new Date().toISOString(),fromType:"agent",fromAgentId:"cubed",fromName:"Cubed",toAgentId:null,toName:"All agents",broadcast:true,kind:"status",content:"Legacy broadcast"}];
 const f=await fixture(t,{agents,messages}),state=await fetch(`${f.base}/api/state`,{headers:f.headers}).then(response=>response.json());assert.equal(state.messages.length,2);assert.deepEqual(state.messages.map(message=>message.id),[1,2]);assert.ok(state.messages.every(message=>message.destination.type==="channel"&&message.destination.name==="release-scope"));assert.deepEqual(state.messages[0].recipientAgentIds,["haven"]);assert.deepEqual(state.messages[1].recipientAgentIds,["haven"]);noLegacyFields(state);const persisted=(await readFile(path.join(f.data,"messages.jsonl"),"utf8")).trim().split(/\r?\n/).map(JSON.parse);assert.equal(persisted.length,2);persisted.forEach(noLegacyFields);
});

test("active channel scopes discovery, all send routes, pending delivery, history, and persists", async t => {
 const f = await fixture(t);
 const get = route => fetch(`${f.base}${route}`, {headers:f.headers}).then(r=>r.json());
 const current = async id => (await get(`/api/agent?agentId=${id}`)).agent;
 const switchTo = (agentId,channel) => f.post('/api/channels/switch',{agentId,channel});
 for (const id of ['a','b','c']) await f.post('/api/register',{agentId:id,requestedName:id,cwd:`/active/${id}`,status:'idle'});
 const defaultChannel=(await current('a')).activeChannel;assert.equal(defaultChannel,'a');
 for (const id of ['a','b','c']) await f.post('/api/channels/join',{agentId:id,channels:['backend','testing']});
 await switchTo('c','testing');
 // Every agent shares every membership, but only a and b are active together.
 assert.deepEqual((await get('/api/agents?agentId=a')).agents.map(a=>a.id),['b']);
 for (const to of ['c','#testing']) {
  const result=await f.post('/api/agent/messages',{agentId:'a',to,content:'wrong scope'});
  assert.equal(result.response.status,403);
 }
 assert.equal((await f.post('/api/user/messages',{originAgentId:'a',to:'c',content:'user can cross projects'})).response.status,201);
 assert.equal((await f.post('/api/agent/messages',{agentId:'a',to:'c',scopeAgent:{id:'spoof',channels:['testing'],activeChannel:'testing'},content:'forged origin scope'})).response.status,403);
 const pending=[];
 for (const to of ['b','*','#backend']) {
  const result=await f.post('/api/agent/messages',{agentId:'a',to,scopeChannel:'testing',content:'active scope'});
  assert.equal(result.response.status,201);assert.deepEqual(result.value.message.recipientAgentIds,['b']);
  assert.equal(result.value.message.scopeChannel,'backend','client cannot spoof the scope');pending.push(result.value.message.id);
 }
 assert.equal((await get('/api/inbox?agentId=b')).messages.length,3);
 assert.deepEqual((await get('/api/messages?channel=BACKEND')).messages.map(m=>m.id),pending,'channel query includes direct, all, and explicit channel destinations by send-time scope');
 assert.deepEqual((await get('/api/messages?agentId=b&channel=%23backend')).messages.map(m=>m.id),pending,'agent channel query agrees with dashboard');
 assert.equal((await get('/api/messages?channel=testing')).messages.length,0);
 await switchTo('b','testing');
 assert.equal((await get('/api/inbox?agentId=b')).messages.length,0);
 assert.equal((await get('/api/messages?agentId=b')).messages.length,0);
 await switchTo('b','backend');
 assert.equal((await get('/api/inbox?agentId=b')).messages.length,0,'switching back must not resurrect unread messages');
 const fresh=await f.post('/api/agent/messages',{agentId:'a',to:'b',content:'new message'});
 assert.deepEqual((await get('/api/inbox?agentId=b')).messages.map(m=>m.id),[fresh.value.message.id]);
 await switchTo('a','testing');await switchTo('b','testing');
 assert.equal((await get('/api/inbox?agentId=b')).messages.length,0,'old direct message cannot follow agents to another shared channel');
 await switchTo('a','backend');await switchTo('b','backend');
 assert.equal((await get('/api/inbox?agentId=b')).messages.length,0,'sender scope changes also revoke old delivery');
 const admin=await f.post('/api/user/messages',{to:'c',content:'dashboard retains administrator authority'});
 assert.equal(admin.response.status,201);assert.equal(admin.value.message.scopeChannel,'user');
 assert.ok((await get('/api/inbox?agentId=c')).messages.some(m=>m.id===admin.value.message.id));
 assert.equal((await switchTo('a','does-not-exist')).response.status,404);
 assert.equal((await current('a')).activeChannel,'backend');
 await f.post('/api/channels/leave',{agentId:'a',channels:['testing']});
 assert.equal((await current('a')).activeChannel,'backend','leaving inactive membership keeps active channel');
 await switchTo('a','testing');assert.ok((await current('a')).channels.includes('testing'),'switch joins existing unjoined channel');
 await f.post('/api/channels/leave',{agentId:'a',channels:['testing']});
 assert.equal((await current('a')).activeChannel,defaultChannel,'leaving active channel chooses first remaining channel');
 await f.post('/api/channels/kick',{agentId:'a',channels:['backend']});
 assert.equal((await current('a')).activeChannel,defaultChannel);
 await f.post('/api/channels/leave',{agentId:'a',channels:[defaultChannel]});
 assert.equal((await current('a')).activeChannel,null);assert.deepEqual((await current('a')).channels,[]);
 assert.equal((await f.post('/api/agent/messages',{agentId:'a',to:'*',content:'no channel'})).value.error.code,'NO_ACTIVE_CHANNEL');
 assert.equal((await f.post('/api/register',{agentId:'a',requestedName:'a',cwd:'/active/a'})).value.agent.activeChannel,null,'reload must not autojoin general');
 await switchTo('a','TESTING');assert.equal((await current('a')).activeChannel,'testing');
 await f.post('/api/channels/close',{channel:'testing'});
 assert.equal((await current('a')).activeChannel,null);assert.equal((await switchTo('a','testing')).response.status,410);
 await f.post('/api/channels/join',{agentId:'a',channels:['zeta','alpha']});
 assert.equal((await current('a')).activeChannel,'zeta','first explicit join target becomes active');
 const rejected=await f.post('/api/channels/join',{agentId:'a',channels:['must-not-create','testing']});
 assert.equal(rejected.response.status,410);assert.ok(!(await get('/api/channels')).channels.some(c=>c.name==='must-not-create'),'invalid batch is atomic');
 await f.post('/api/policy/global',{enabled:false});assert.equal((await switchTo('a','alpha')).response.status,403);await f.post('/api/policy/global',{enabled:true});
 await stop(f.child);f.child=spawn(process.execPath,[broker,path.join(f.dir,'config.json')],{stdio:'ignore'});await wait(f.base);
 assert.equal((await current('a')).activeChannel,'zeta','active channel survives broker restart');
 assert.equal((await get('/api/channels?agentId=a')).channels.find(c=>c.name==='zeta').active,true);
});

test('project defaults isolate peers; user inbox reaches selected agents without reply fan-out', async t => {
 const f=await fixture(t), get=route=>fetch(f.base+route,{headers:f.headers}).then(r=>r.json());
 const register=(id,cwd)=>f.post('/api/register',{agentId:id,requestedName:id,cwd,status:'idle'});
 const a=(await register('a','/work/same')).value.agent,b=(await register('b','/work/same')).value.agent,c=(await register('c','/work/other')).value.agent;
 assert.equal(a.activeChannel,b.activeChannel);assert.notEqual(a.activeChannel,c.activeChannel);
 assert.deepEqual((await get('/api/agents?agentId=a')).agents.map(a=>a.id),['b']);
 assert.equal((await f.post('/api/agent/messages',{agentId:'a',to:'c',content:'not allowed'})).response.status,403);
 assert.equal((await f.post('/api/channels/join',{agentId:'a',channels:['user']})).value.error.code,'USER_CHANNEL_ONLY');
 const selected=(await f.post('/api/user/messages',{to:'#user',recipientAgentIds:['a','c'],content:'User instruction'})).value.message;
 assert.deepEqual(selected.recipientAgentIds,['a','c']);assert.equal(selected.scopeChannel,'user');
 const reply=(await f.post('/api/agent/messages',{agentId:'a',to:'#user',content:'Reply for the user'})).value.message;
 assert.deepEqual(reply.recipientAgentIds,[]);assert.equal(reply.administrative,true);
 assert.equal((await get('/api/inbox?agentId=b')).messages.length,0);
 assert.deepEqual((await get('/api/messages?agentId=b')).messages,[]);
 assert.ok((await get('/api/messages?agentId=a')).messages.some(m=>m.id===reply.id));
 assert.ok((await get('/api/state')).messages.some(m=>m.id===reply.id));
 const all=(await f.post('/api/user/messages',{to:'#user',content:'All projects'})).value.message;
 assert.deepEqual(all.recipientAgentIds,['a','b','c']);
 assert.equal((await f.post('/api/channels/close',{channel:'user'})).response.status,409);
});

test('legacy general migrations preserve custom selection and immutable history', async t => {
 const old={id:1,messageId:'old',fromType:'agent',fromAgentId:'a',fromName:'a',timestamp:new Date().toISOString(),scopeChannel:'general',destination:{type:'channel',id:'general',name:'general'},recipientAgentIds:['b'],content:'Historical',kind:'message'};
 const f=await fixture(t,{agents:{a:{id:'a',name:'a',cwd:'/migration/a',channels:['general'],activeChannel:'general'},b:{id:'b',name:'b',cwd:'/migration/b',channels:['general','custom'],activeChannel:'custom'}},messages:[old]});
 const state=await fetch(f.base+'/api/state',{headers:f.headers}).then(r=>r.json());
 assert.equal(state.agents.find(a=>a.id==='a').activeChannel,'a');
 assert.equal(state.agents.find(a=>a.id==='b').activeChannel,'custom');
 assert.equal(state.channels.some(c=>c.name==='general'),false);
 assert.deepEqual(state.messages,[old]);
});

test('authenticated live events publish heartbeat activity transitions', async t => {
 const f=await fixture(t);await f.post('/api/register',{agentId:'a',requestedName:'a',cwd:'/live/a'});
 assert.equal((await fetch(f.base+'/api/events')).status,401);
 const cancel=new AbortController();t.after(()=>cancel.abort());
 const response=await fetch(f.base+'/api/events',{headers:f.headers,signal:cancel.signal}),reader=response.body.getReader();
 assert.match(new TextDecoder().decode((await reader.read()).value),/ready/);
 const beat=await f.post('/api/heartbeat',{agentId:'a',status:'working',activity:'thinking'});
 assert.equal(beat.value.agent.activity,'thinking');
 assert.match(new TextDecoder().decode((await reader.read()).value),/changed/);
 let received=false;const next=reader.read().then(packet=>{received=true;return packet});
 await f.post('/api/heartbeat',{agentId:'a',status:'working',activity:'thinking'});
 await f.post('/api/ack',{agentId:'a',messageId:0});
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(received,false,'unchanged heartbeats/acks must not wake every dashboard');
 await f.post('/api/heartbeat',{agentId:'a',status:'idle',activity:'waiting'});
 assert.match(new TextDecoder().decode((await next).value),/changed/);
 cancel.abort();
});
