import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {demoCases} from '../demo-work.mjs';
const root=process.env.MESH_TEST_EXTENSION_ROOT||fileURLToPath(new URL('..',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await pause(20)}throw Error(`Timeout: ${label}`)}
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port}

test('real /mesh demo22: invalid/cancelled commands spawn none; approval creates22 no-tool SDK agents with synthetic local SSE and parent PASS report',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'mesh-demo-rpc-')),agent=join(directory,'agent'),project=join(directory,'project'),home=join(directory,'mesh');
 mkdirSync(agent);mkdirSync(project);mkdirSync(join(agent,'mesh'));
 writeFileSync(join(project,'sentinel.txt'),'DO NOT CHANGE');
 // Deliberately unsafe effective user profiles must never affect the reserved demo.
 writeFileSync(join(agent,'mesh','profiles.json'),JSON.stringify(Object.fromEntries(['scout','reviewer','auditor'].map(role=>[role,{write:true,tools:['bash','edit','write'],model:'absent/unsafe',prompt:'UNSAFE_CUSTOM_PROFILE_DO_NOT_INHERIT'}]))));
 const expected=new Map(demoCases(22).map(item=>[item.id,{task:item.id,result:item.expected,status:'done'}])),requests=[],fixtureErrors=[];
 let active=0,peak=0;
 const server=createServer(async(request,response)=>{
  try{
   assert.equal(request.url,'/v1/chat/completions');assert.equal(request.headers.authorization,'Bearer FIXTURE_ONLY');let body='';for await(const chunk of request)body+=chunk;
   const input=JSON.parse(body);assert(!input.tools?.length,'Demo model must have no tools');const prompt=JSON.stringify(input.messages),current=JSON.stringify(input.messages.filter(m=>m.role==='user').at(-1)),id=/task=\\?"(demo-\d{3})/.exec(current)?.[1];assert(expected.has(id),'Only assigned demo worker requests are permitted');
   assert(!prompt.includes('UNSAFE_CUSTOM_PROFILE_DO_NOT_INHERIT'));assert(!prompt.includes('Persistent role memory'));requests.push(id);peak=Math.max(peak,++active);await pause(20);
   response.writeHead(200,{'Content-Type':'text/event-stream'});const send=value=>response.write('data: '+JSON.stringify(value)+'\n\n');
   send({id:'fixture-'+id,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(expected.get(id))}}]});send({id:'fixture-'+id,choices:[{index:0,delta:{},finish_reason:'stop'}]});send({choices:[],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}});response.end('data: [DONE]\n\n');active--;
  }catch(error){fixtureErrors.push(error.message);response.destroy();active=Math.max(0,active-1)}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${server.address().port}/v1`,port=await freePort();
 writeFileSync(join(agent,'models.json'),JSON.stringify({providers:{'demo-fixture':{baseUrl:endpoint,api:'openai-completions',apiKey:'FIXTURE_ONLY',models:[{id:'local',reasoning:false,contextWindow:128000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
 writeFileSync(join(agent,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off'}));
 const windowsCli=join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'npm','node_modules','@earendil-works','pi-coding-agent','dist','cli.js');
 const child=spawn(process.platform==='win32'?process.execPath:'pi',[...(process.platform==='win32'?[windowsCli]:[]),'--mode','rpc','--no-session','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--provider','demo-fixture','--model','local','--thinking','off','-e',resolve(root,'index.ts')],{cwd:project,env:{...process.env,PI_CODING_AGENT_DIR:agent,PI_AGENT_MESH_HOME:home,PI_AI_GATEWAY_HOME:join(directory,'gateway'),PI_AGENT_MESH_PORT:String(port),PI_AGENT_NAME:'Demo fixture supervisor',PI_SKIP_VERSION_CHECK:'1',PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']});
 let buffer='',stderr='',sequence=0;const events=[];child.stderr.on('data',data=>stderr+=data);child.stdout.on('data',data=>{buffer+=data;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{events.push(JSON.parse(line))}catch{}}});
 let config,runId;
 t.after(async()=>{
  // Stop only fixture work before disposing its resources, even on an assertion failure.
  if(!config&&existsSync(join(home,'config.json')))config=JSON.parse(readFileSync(join(home,'config.json')));
  if(config&&existsSync(join(config.dataDir,'runs'))){for(const id of readdirSync(join(config.dataDir,'runs'))){try{const state=JSON.parse(readFileSync(join(config.dataDir,'runs',id,'state.json')));if(state.pid&&['running','starting','paused'].includes(state.state))process.kill(state.pid,'SIGTERM')}catch{}}}
  child.stdin.end();if(child.exitCode===null&&child.signalCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),pause(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await wait(()=>child.exitCode!==null||child.signalCode!==null,'fixture Pi shutdown',5000)}
  if(config){const health=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json()).catch(()=>null);if(health?.instance===createHash('sha256').update(config.token).digest('hex').slice(0,16))try{process.kill(health.pid,'SIGTERM')}catch{}await wait(()=>fetch(`http://127.0.0.1:${port}/health`).then(()=>false).catch(()=>true),'fixture broker shutdown')}
  server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});
 });
 async function command(type,data={},approve){const id='demo-rpc-'+(++sequence),start=events.length;child.stdin.write(JSON.stringify({id,type,...data})+'\n');if(approve!==undefined){const dialog=await wait(()=>events.slice(start).find(e=>e.type==='extension_ui_request'&&e.method==='confirm'),'approval dialog '+stderr);assert.match(dialog.message,/DEMO \/ SMOKE TEST/);assert.match(dialog.message,/child spawns: 22 \| concurrency: 4/);assert.match(dialog.message,/Tools: \(none\)/);assert.match(dialog.message,/Exact model: demo-fixture\/local/);child.stdin.write(JSON.stringify({type:'extension_ui_response',id:dialog.id,...(approve?{confirmed:true}:{cancelled:true})})+'\n')}
  const response=await wait(()=>events.find(e=>e.type==='response'&&e.id===id),type+' '+stderr);assert.equal(response.success,true,response.error||stderr);return{data:response.data,events:events.slice(start)};
 }
 await command('get_state');config=JSON.parse(readFileSync(join(home,'config.json')));
 for(const raw of ['demo','demo 0','demo -1','demo 65','demo 1.5','demo 22 extra']){const result=await command('prompt',{message:'/mesh '+raw});assert(result.events.some(e=>e.method==='notify'&&String(e.message).includes('Usage: /mesh demo')));assert(!result.events.some(e=>e.method==='confirm'))}
 await command('prompt',{message:'/mesh demo 22'},false);assert.deepEqual(existsSync(join(config.dataDir,'runs'))?readdirSync(join(config.dataDir,'runs')):[],[]);assert.equal(requests.length,0);
 const launched=await command('prompt',{message:'/mesh DEMO 22'},true);assert(launched.events.some(e=>e.method==='notify'&&String(e.message).includes('22 agents requested')));
 const runs=readdirSync(join(config.dataDir,'runs'));assert.equal(runs.length,1);runId=runs[0];const dir=join(config.dataDir,'runs',runId);
 const result=await wait(()=>{const state=JSON.parse(readFileSync(join(dir,'state.json')));return['completed','failed','cancelled'].includes(state.state)?state:null},'22 fixture SDK agents complete '+stderr,60000);
 assert.equal(result.state,'completed',JSON.stringify({error:result.error,steps:result.steps,fixtureErrors}));assert.equal(result.steps.length,22);assert.equal(result.calls,22);assert.equal(new Set(result.steps.map(s=>s.agentId)).size,22);assert(result.steps.every(s=>s.name&&s.sessionFile&&s.acceptance[0].passed));assert.equal(requests.length,22);assert.equal(new Set(requests).size,22);assert(peak<=4);assert.deepEqual(fixtureErrors,[]);
 const spec=JSON.parse(readFileSync(join(dir,'spec.json')));for(const task of spec.plan.stages.flatMap(s=>s.tasks)){assert.equal(task.write,false);assert.deepEqual(task.tools,[]);assert.deepEqual(task.extensions,[]);assert.equal(task.model,'demo-fixture/local')}
 const report=await wait(async()=>{const response=await command('get_messages');return response.data.messages.find(m=>m.customType==='mesh-result'&&String(m.content).startsWith(`Mesh demo ${runId}: PASS`))},'deterministic parent report');assert.match(report.content,/accepted: 22\/22/);for(const item of demoCases(22))assert(report.content.includes(item.id+' ·'));
 const records=JSON.parse(readFileSync(join(config.dataDir,'agents.json')));for(const step of result.steps){assert.equal(records[step.agentId].parentAgentId,spec.parentId);assert.equal(records[step.agentId].runId,runId)}
 assert.equal(readFileSync(join(project,'sentinel.txt'),'utf8'),'DO NOT CHANGE');assert.deepEqual(result.workspaces,[]);
 assert.equal(events.filter(e=>e.method==='confirm').length,2,'exactly cancel and accept reviews');
});
