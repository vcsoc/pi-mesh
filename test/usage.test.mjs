import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import { UsageStore, usageFilter } from '../usage.mjs';

const header={type:'session',id:'original-session'};
const entry=(id,timestamp,extra={})=>({type:'message',id,timestamp,message:{role:'assistant',timestamp,provider:'anthropic',model:'fixture-model',usage:{input:10,output:4,cacheWrite:2,cacheRead:8,cost:{total:.025}},...extra}});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'mesh-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'session.jsonl'),write=entries=>writeFile(file,[header,...entries].map(e=>JSON.stringify(e)).join('\n')+'\n');const agent={id:'a',name:'app-orc',role:'orchestrator',projectHash:'hash-a',projectName:'app',cwd:dir,sessionFile:file,channels:['app','shared'],activeChannel:'app',registeredAt:'2026-01-01T00:00:00Z'};return {dir,file,write,agent,store:new UsageStore(),channels:[{name:'app',projectHash:'hash-a'},{name:'shared'}]};}
const group=report=>report.projects[0].agents[0];

test('usage date validation, inclusive endpoints, mixed forms and real calendar dates',()=>{
 for(const query of ['date=','timezone=','date=2026-02-30','date=2026-13-01','date=26-01-01','start=2026-01-01','end=2026-01-01','start=2026-02-01&end=2026-01-01','date=2026-01-01&start=2026-01-01&end=2026-01-01','timezone=not-a-zone'])assert.throws(()=>usageFilter(new URLSearchParams(query)),e=>e.status===400);
 const range=usageFilter(new URLSearchParams('start=2024-02-29&end=2024-03-01'));assert.equal(range.start,'2024-02-29');assert.equal(range.end,'2024-03-01');assert.equal(usageFilter().timezone,'UTC');
});
test('usage groups project, logical agent, date and exact provider/model with inclusive totals',async t=>{
 const f=await fixture(t);await f.write([entry('a','2026-01-01T00:00:00Z'),entry('b','2026-01-02T23:59:59Z',{provider:'openai',model:'second'}),entry('c','2026-01-03T00:00:00Z'),{type:'message',id:'user',message:{role:'user',usage:{input:900}}}]);
 const report=await f.store.query([f.agent],f.channels,new URLSearchParams('start=2026-01-01&end=2026-01-02'));
 assert.equal(report.projects[0].name,'app');assert.deepEqual(report.projects[0].channels,['app']);assert.deepEqual(group(report).channels,['app','shared']);assert.deepEqual(group(report).days.map(d=>d.date),['2026-01-01','2026-01-02']);assert.deepEqual(group(report).totals,{input:20,output:8,cacheCreate:4,cacheRead:16,cost:.05});assert.equal(group(report).days[1].models[0].provider,'openai');
 const day=await f.store.query([f.agent],f.channels,new URLSearchParams('date=2026-01-02'));assert.equal(group(day).totals.input,10);assert.equal(group(day).days.length,1);
});
test('usage counts cache warming, nested tool usage, compaction and branch summaries without inventing their models',async t=>{
 const f=await fixture(t),timestamp='2026-01-01T00:00:00Z',u=(input,output,cacheRead,cost)=>({input,output,cacheRead,cacheWrite:0,cost:{total:cost}});await f.write([
  entry('assistant',timestamp),{type:'usage',id:'warm',timestamp,kind:'future-unknown-kind',provider:'anthropic',model:'fixture-model',usage:u(0,0,100,.02)},
  {type:'message',id:'tool',timestamp,message:{role:'toolResult',timestamp,usage:u(3,1,0,.01)}},
  {type:'compaction',id:'compact',timestamp,usage:u(5,2,0,.03)},
  {type:'branch_summary',id:'branch',timestamp,usage:u(1,1,0,.01)},
 ]);const report=await f.store.query([f.agent],f.channels),totals=group(report).totals;assert.equal(totals.input,19);assert.equal(totals.output,8);assert.equal(totals.cacheCreate,2);assert.equal(totals.cacheRead,108);assert.ok(Math.abs(totals.cost-.095)<1e-10);assert.equal(report.coverage.unknownModels,3);assert.equal(group(report).days[0].models.find(m=>m.provider==='unknown').input,9);
});
test('usage timezone uses local days including DST transitions, not UTC string slices',async t=>{
 const f=await fixture(t);await f.write([entry('a','2026-03-08T04:59:59Z'),entry('b','2026-03-08T05:00:00Z'),entry('c','2026-03-09T03:59:59Z'),entry('d','2026-03-09T04:00:00Z')]);
 const report=await f.store.query([f.agent],f.channels,new URLSearchParams('date=2026-03-08&timezone=America/New_York'));assert.equal(group(report).totals.input,20);assert.equal(group(report).days[0].date,'2026-03-08');
});
test('multiple providers/models aggregate independently; zero costs stay zero and unknown metadata stays unknown',async t=>{
 const f=await fixture(t);await f.write([entry('a','2026-01-01',{usage:{input:0,output:0,cacheWrite:0,cacheRead:0,cost:{total:0}}}),entry('b','2026-01-01',{provider:'openai',model:'other',usage:{input:3,output:2,cacheRead:5,cost:{input:.01,output:.02,cacheWrite:0,cacheRead:0}}}),entry('c','2026-01-01',{usage:{input:-1,output:1}})]);
 const report=await f.store.query([f.agent],f.channels);assert.equal(group(report).days[0].models.length,2);assert.equal(group(report).totals.input,null);assert.equal(group(report).totals.cacheCreate,null);assert.equal(group(report).totals.cost,null);assert.equal(group(report).days[0].models.find(m=>m.provider==='openai').cost,.03);
});
test('shared files, resumed copies and branch copies never bill old turns twice or shift their original owner',async t=>{
 const f=await fixture(t),old=entry('old','2026-01-01');await f.write([old]);const copy=join(f.dir,'copy.jsonl');await writeFile(copy,[{...header,id:'branched-session'},old,entry('new','2026-01-02')].map(e=>JSON.stringify(e)).join('\n')+'\n');
 const child={...f.agent,id:'child',name:'app-dev',role:'developer',sessionFile:copy,registeredAt:'2026-01-02'};
 const report=await f.store.query([child,f.agent,{...f.agent,id:'reload'}],f.channels);assert.equal(report.coverage.readableSessions,2);assert.equal(report.coverage.duplicates,1);assert.equal(report.projects[0].agents.length,2);const orc=report.projects[0].agents.find(a=>a.role==='orchestrator'),dev=report.projects[0].agents.find(a=>a.role==='developer');assert.equal(orc.totals.input,10);assert.equal(dev.totals.input,10);assert.deepEqual(dev.days.map(d=>d.date),['2026-01-02']);
});
test('usage includes retired/offline sessions, readable zero-use sessions and unavailable sessions without inventing zero totals',async t=>{
 const f=await fixture(t);await f.write([]);const missing={...f.agent,id:'missing',name:'Archived-dev',previousName:'app-dev',role:'developer',sessionFile:join(f.dir,'missing.jsonl'),removedAt:'2026-01-03',channels:[]};const report=await f.store.query([f.agent,missing],f.channels);assert.equal(report.coverage.unavailableSessions,1);const dev=report.projects[0].agents.find(a=>a.role==='developer');assert.equal(dev.name,'app-dev');assert.equal(dev.available,false);assert.equal(dev.totals.cost,null);assert.equal(group(report).days.length,0);
});
test('incremental usage cache handles appended turns, UTF-8 partial lines, truncation, corrections and concurrent requests',async t=>{
 const f=await fixture(t);await f.write([entry('one','2026-01-01')]);await f.store.query([f.agent],f.channels);const added=JSON.stringify(entry('two','2026-01-02',{model:'modèle'})),bytes=Buffer.from(added+'\n'),split=bytes.indexOf(Buffer.from('è'))+1;await appendFile(f.file,bytes.subarray(0,split));let report=await f.store.query([f.agent],f.channels);assert.equal(group(report).totals.input,10);assert.equal(report.coverage.pendingLines,1);await appendFile(f.file,bytes.subarray(split));const reports=await Promise.all([f.store.query([f.agent],f.channels),f.store.query([f.agent],f.channels)]);for(const r of reports){assert.equal(group(r).totals.input,20);assert.equal(group(r).days[1].models[0].model,'modèle');}
 await f.write([entry('replacement','2026-01-03')]);report=await f.store.query([f.agent],f.channels);assert.equal(group(report).totals.input,10);assert.deepEqual(group(report).days.map(d=>d.date),['2026-01-03']);
});
test('long transcript lines are read linearly without repeatedly copying growing buffers',async t=>{
 const f=await fixture(t);await f.write([{type:'message',id:'large-tool',message:{role:'toolResult',content:'x'.repeat(4*1024*1024)}},entry('billable','2026-01-01')]);const original=Buffer.concat;let copied=0;Buffer.concat=(list,length)=>{copied+=length??list.reduce((n,b)=>n+b.length,0);return original(list,length);};let report;try{report=await f.store.query([f.agent],f.channels);}finally{Buffer.concat=original;}
 assert.equal(group(report).totals.input,10);assert.ok(copied<12*1024*1024,`copied ${copied} bytes while reading one 4MB line`);
});
test('usage reports malformed timestamps/records and never exports session contents, paths or unrelated files',async t=>{
 const f=await fixture(t);await f.write([entry('valid','2026-01-01',{content:[{type:'text',text:'PRIVATE_PROMPT_SECRET'}]}),entry('invalid','nonsense')]);await appendFile(f.file,'not JSON\n');const unrelated=join(f.dir,'unregistered.jsonl');await writeFile(unrelated,JSON.stringify(header)+'\n'+JSON.stringify(entry('extra','2026-01-01'))+'\n');const report=await f.store.query([f.agent],f.channels);assert.equal(group(report).totals.input,10);assert.equal(report.coverage.invalidTimestamps,1);assert.equal(report.coverage.malformedLines,1);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_PROMPT_SECRET|session\.jsonl|unregistered\.jsonl/);
});
test('real isolated usage HTTP endpoint requires auth, validates filters, serves assets and leaves transcripts unchanged',async t=>{
 const f=await fixture(t),cwd=await realpath(f.dir);await f.write([entry('a','2026-01-01'),entry('b','2026-01-02')]);
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));const token=randomBytes(32).toString('hex'),data=join(f.dir,'data'),config=join(f.dir,'config.json');await mkdir(data);await writeFile(config,JSON.stringify({host:'127.0.0.1',port,token,dataDir:data}));
 const child=spawn(process.execPath,[new URL('../broker.mjs',import.meta.url).pathname,config],{stdio:'ignore'});t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}});const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};const registered=await fetch(base+'/api/register',{method:'POST',headers,body:JSON.stringify({agentId:'a',cwd,role:'orchestrator',sessionFile:f.file,projectHash:createHash('sha256').update('agent-mesh-project\0'+cwd).digest('hex')})});assert.equal(registered.status,200);
 const before=await readFile(f.file);assert.equal((await fetch(base+'/api/usage')).status,401);assert.equal((await fetch(base+'/api/usage?date=2026-02-30',{headers})).status,400);const result=await fetch(base+'/api/usage?start=2026-01-01&end=2026-01-02',{headers});assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);assert.equal(group(await result.json()).totals.input,20);assert.equal((await fetch(base+'/usage-panel.js',{headers})).status,200);assert.equal((await fetch(base+'/usage-panel.js')).status,401);assert.deepEqual(await readFile(f.file),before);
});
