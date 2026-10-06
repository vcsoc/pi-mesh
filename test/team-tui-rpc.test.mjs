import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import net from 'node:net';
const root=process.env.MESH_TEST_EXTENSION_ROOT || resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function wait(fn){const end=Date.now()+12000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw new Error('RPC test timeout');}
test('real Pi RPC refuses the terminal-only team composer without approval or worker creation',async t=>{
 if(process.platform==='win32'){t.skip('Unix installed Pi executable fixture');return;}
 const agentDir=await mkdtemp(join(tmpdir(),'mesh-team-tui-rpc-')),home=join(agentDir,'mesh');
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 await writeFile(join(agentDir,'models.json'),JSON.stringify({providers:{'mesh-local':{baseUrl:'http://127.0.0.1:9/v1',api:'openai-completions',apiKey:'fixture-not-used',models:[{id:'fixture',reasoning:false}]}}}));
 await writeFile(join(agentDir,'settings.json'),JSON.stringify({defaultProvider:'mesh-local',defaultModel:'fixture'}));
 const child=spawn('pi',['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','-e',join(root,'index.ts')],{cwd:agentDir,env:{...process.env,PI_CODING_AGENT_DIR:agentDir,PI_AGENT_MESH_HOME:home,PI_AGENT_MESH_PORT:String(port),PI_SKIP_VERSION_CHECK:'1'},stdio:['pipe','pipe','pipe']});
 let buffer='',stderr='';const events=[];child.stderr.on('data',c=>stderr+=c);child.stdout.on('data',c=>{buffer+=c;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{events.push(JSON.parse(line));}catch{}}});
 t.after(async()=>{
  if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}
  try{const cfg=JSON.parse(await readFile(join(home,'config.json'),'utf8')),health=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json());if(health.instance===createHash('sha256').update(cfg.token).digest('hex').slice(0,16))process.kill(health.pid,'SIGTERM');}catch{}
  await rm(agentDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 });
 child.stdin.write(JSON.stringify({id:'team',type:'prompt',message:'/mesh team Fixture request; never generate'})+'\n');
 const notice=await wait(()=>events.find(e=>e.type==='extension_ui_request'&&e.method==='notify'&&String(e.message).includes('requires interactive Pi TUI')));
 assert.match(notice.message,/No work was started/);
 assert.equal((await wait(()=>events.find(e=>e.type==='response'&&e.id==='team'))).success,true,stderr);
 assert.equal(events.some(e=>e.type==='extension_ui_request'&&e.method==='confirm'),false,'No obsolete JSON approval fallback');
 const cfg=JSON.parse(await readFile(join(home,'config.json'),'utf8'));
 assert.deepEqual(await readdir(join(cfg.dataDir,'runs')).catch(()=>[]),[]);
});
