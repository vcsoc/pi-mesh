// Isolated dashboard performance regression. No broker, auth or model calls.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/dashboard-performance-browser.mjs
// MESH_DASHBOARD_ROOT selects an installed/baseline checkout; MESH_PERF_BASELINE=1 records old behavior.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(process.env.MESH_DASHBOARD_ROOT||fileURLToPath(new URL('..',import.meta.url)));
const baseline=process.env.MESH_PERF_BASELINE==='1';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const agents=Array.from({length:25},(_,i)=>({id:`a${i}`,name:`Agent ${String(i).padStart(2,'0')}`,generation:1,status:'idle',activity:'idle',enabled:true,effectiveEnabled:true,activeChannel:`project-${i%22}`,channels:[`project-${i%22}`],cwd:'/fixture',projectName:'fixture',projectHash:'a'.repeat(64),model:'fixture/model',thinkingLevel:'off',configurable:false,lastSeenAt:0}));
const channels=Array.from({length:23},(_,i)=>({name:i===22?'user':`project-${i}`,aliases:i===0?['old-project-0']:[],userOnly:i===22,memberCount:agents.filter(a=>a.channels.includes(`project-${i}`)).length,memberNames:agents.filter(a=>a.channels.includes(`project-${i}`)).map(a=>a.name)}));
const history=Array.from({length:1000},(_,i)=>({id:i+1,fromAgentId:`a${i%25}`,fromName:`Agent ${String(i%25).padStart(2,'0')}`,fromType:'agent',scopeChannel:i%22===0?'OLD-PROJECT-0':`project-${i%22}`,destination:{type:'agent',id:`a${(i+1)%25}`,name:`Agent ${String((i+1)%25).padStart(2,'0')}`},recipientAgentIds:[`a${(i+1)%25}`],kind:'message',timestamp:'2026-01-01T10:00:00Z',content:`Fixture message ${i+1}\n${'Long coordination history. '.repeat(100)}`}));
const state={agents,channels,messages:history.slice(-250),totalMessages:history.length,policy:{enabled:true,blockedProjects:[]}};
const files={'/':'dashboard.html','/dashboard.js':'dashboard.js','/topology-layout.mjs':'topology-layout.mjs','/dashboard.css':'dashboard.css','/fleet-panel.js':'fleet-panel.js','/usage-panel.js':'usage-panel.js','/management-workbench.js':'management-workbench.js','/management-workbench.css':'management-workbench.css','/policy-schema.mjs':'security/policy-schema.mjs'};
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],posts=[];let stateRequests=0,fleetRequests=0,inflight=0,maxInflight=0,delay=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.EventSource=class{constructor(){window.fixtureEvents=this}close(){}emit(){this.onmessage?.({data:'changed'})}};
  const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(()=>{if(ms!==1500||!window.freezePolling)fn(...args)},ms);
  window.createCount=0;window.articleCount=0;const create=document.createElement.bind(document);document.createElement=(...args)=>{window.createCount++;if(args[0]==='article')window.articleCount++;return create(...args)};
 });
 await page.route('http://mesh.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST'){posts.push(path);return route.fulfill({status:403,json:{error:{message:'Fixture policy denied'}}})}
  if(path==='/api/state'){stateRequests++;inflight++;maxInflight=Math.max(maxInflight,inflight);const snapshot=JSON.stringify(state);if(delay)await new Promise(r=>setTimeout(r,delay));inflight--;return route.fulfill({body:snapshot,contentType:'application/json'})}
  if(path==='/api/messages'){const before=Number(new URL(route.request().url()).searchParams.get('before'));return route.fulfill({json:{messages:history.filter(m=>m.id<before).slice(-250)}})}
  if(path==='/api/fleet'){fleetRequests++;return route.fulfill({json:{runs:[]}});}
  if(files[path])return route.fulfill({body:(await readFile(resolve(root,files[path]),'utf8'))+(path==='/dashboard.js'?'\nwindow.refresh=refresh;Object.defineProperty(window,"polling",{configurable:true,get:()=>polling});':''),contentType:path.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(path)?'text/javascript':'text/html'});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://mesh.test');await page.waitForSelector('.message[data-message-id="1000"]');
 for(let i=0;i<3;i++)await page.locator('#load-older').click();
 await page.waitForFunction(()=>document.querySelectorAll('.message').length===1000);
 await page.locator('#auto-scroll').uncheck();
 await page.evaluate(()=>{window.freezePolling=true});await page.waitForFunction(()=>!polling);
 await page.evaluate(()=>{window.stableMessage=document.querySelector('[data-message-id="900"]');window.stableAgent=document.querySelector('.person');window.stableThread=document.querySelector('.thread-row');window.stableGraph=document.querySelector('.topology-graph');window.stableMessage.focus({preventScroll:true});document.querySelector('#timeline-main').scrollTop=600;window.createCount=0;});
 const stable=await page.evaluate(async()=>{const times=[];for(let i=0;i<6;i++){const start=performance.now();await refresh();times.push(Math.round(performance.now()-start));}return{ms:times,created:window.createCount,messageRetained:window.stableMessage.isConnected,agentRetained:window.stableAgent.isConnected,threadRetained:window.stableThread.isConnected,graphRetained:window.stableGraph.isConnected,focusRetained:document.activeElement===window.stableMessage,scroll:document.querySelector('#timeline-main').scrollTop}});
 console.log(JSON.stringify({mode:baseline?'baseline':'fixed',fixture:{agents:25,channels:23,messages:1000},stableRefresh:stable}));
 if(!baseline){assert.equal(stable.created,0,'identical refreshes must not rebuild any HTML nodes');for(const k of ['messageRetained','agentRetained','threadRetained','graphRetained','focusRetained'])assert.equal(stable[k],true,k);assert.equal(stable.scroll,600);}
 // Heartbeat-only telemetry must not replace panels, focus, or open composer selects.
 state.agents.forEach(a=>{a.lastSeenAt++;a.lastAck++;});
 const heartbeat=await page.evaluate(async()=>{window.createCount=0;await refresh();return{created:window.createCount,messageRetained:window.stableMessage.isConnected,agentRetained:window.stableAgent.isConnected}});
 if(!baseline){assert.equal(heartbeat.created,0);assert.equal(heartbeat.messageRetained,true);assert.equal(heartbeat.agentRetained,true);}
 // One new message creates only its own row; unchanged history survives.
 const next={...history.at(-1),id:1001,content:'New fixture message'};state.messages=[...state.messages.slice(1),next];state.totalMessages++;
 const added=await page.evaluate(async()=>{window.createCount=0;window.articleCount=0;const t=performance.now();await refresh();return{ms:Math.round(performance.now()-t),created:window.createCount,messageRowsCreated:window.articleCount,messageRetained:window.stableMessage.isConnected,focusRetained:document.activeElement===window.stableMessage}});
 assert.equal(await page.locator('.message').count(),1001);if(!baseline){assert.equal(added.messageRetained,true);assert.equal(added.focusRetained,true);assert.equal(added.messageRowsCreated,1,'only the new message row should be created');assert.ok(added.created<1000,`new message rebuilt ${added.created} nodes`);}
 // Actual status, topology membership and policy remain live; alias-scoped history stays correct.
 state.agents[0].status='working';state.agents[0].activity='thinking';state.agents[0].activeChannel='project-1';state.agents[0].channels=['project-1'];state.policy.enabled=false;
 await page.evaluate(()=>refresh());assert.equal(await page.locator('#mesh-enabled').isChecked(),false);assert.equal(await page.locator('[data-node="agent:a0"].working').count(),1);
 await page.locator('.thread-row').filter({hasText:'#project-0'}).click();assert.equal(await page.locator('.message').count(),history.filter(m=>m.scopeChannel==='OLD-PROJECT-0').length);
 await page.locator('[data-view="matrix"]').click();assert.equal(await page.locator('tr[data-agent="a0"] .matrix-status').textContent(),'Thinking');assert.equal(await page.locator('tr[data-agent="a0"] .matrix-current').textContent(),'#project-1');
 await page.locator('[data-view="all"]').click();assert.equal(await page.locator('#top-thread').textContent(),'All messages');
 if(!baseline){
  // Hundreds of simultaneous SSE notifications coalesce, including events arriving during a slow request.
  delay=180;const before=stateRequests;await page.evaluate(()=>{for(let i=0;i<200;i++)window.fixtureEvents.emit();setTimeout(()=>{for(let i=0;i<200;i++)window.fixtureEvents.emit()},180)});await page.waitForTimeout(800);
  assert.ok(stateRequests-before<=3,`burst performed ${stateRequests-before} state fetches`);assert.equal(maxInflight,1,'never overlap state fetches');delay=0;
  // Poll and SSE stop while hidden; foregrounding refreshes immediately.
  await page.locator('[data-view="fleet"]').click();await page.waitForFunction(()=>document.querySelector('#fleet-runs p'));const beforeFleet=fleetRequests;
  const beforeHidden=stateRequests;await page.evaluate(()=>{window.freezePolling=false;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));for(let i=0;i<20;i++)window.fixtureEvents.emit()});await page.waitForTimeout(1800);assert.equal(stateRequests,beforeHidden);assert.equal(fleetRequests,beforeFleet,'active fleet polling also stops in background tabs');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');await page.waitForTimeout(150);assert.ok(stateRequests>beforeHidden);assert.ok(fleetRequests>beforeFleet);await page.locator('[data-view="all"]').click();
  // Correction of an existing message is not mistaken for an unchanged heartbeat.
  state.messages.at(-1).content='Corrected fixture message';await page.evaluate(()=>refresh());assert.match(await page.locator('[data-message-id="1001"]').textContent(),/Corrected fixture message/);
  await page.locator('[data-message-id="1001"] .message-body').click();assert.equal(await page.locator('[data-message-id="1001"]').getAttribute('aria-current'),'true');await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-message-id="1000"]').getAttribute('aria-current'),'true');
  // Auto-follow reaches the real end of a newly rendered long message, not only its estimated offscreen height.
  await page.locator('#auto-scroll').check();await page.waitForTimeout(400);state.messages=[...state.messages.slice(1),{...next,id:1002,content:'New long message. '.repeat(1000)}];state.totalMessages++;await page.evaluate(()=>refresh());await page.waitForTimeout(150);const bottomGap=await page.locator('#timeline-main').evaluate(n=>n.scrollHeight-n.clientHeight-n.scrollTop);assert.ok(bottomGap<2,`auto-scroll missed the end by ${bottomGap}px`);
  // Failed controls must revert/re-enable even when unchanged-state refreshes deliberately retain DOM nodes.
  await page.locator('.person[data-agent="a0"] input').click({force:true});await page.waitForFunction(()=>{const input=document.querySelector('.person[data-agent="a0"] input');return input.checked&&!input.disabled});
  await page.locator('#mesh-enabled').click({force:true});await page.waitForFunction(()=>{const input=document.querySelector('#mesh-enabled');return !input.checked&&!input.disabled});
  // Layout callbacks must not erase persisted orbital scope before the first state response arrives.
  await page.evaluate(()=>{localStorage.setItem('mesh-topology-mode','orbital');localStorage.setItem('mesh-orbit-system','project-0');localStorage.setItem('mesh-orbit-paused','true')});delay=200;await page.reload();await page.waitForSelector('[data-node="channel:project-0"].sun');assert.equal(await page.locator('#topology-layout').inputValue(),'orbital');delay=0;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(posts,baseline?[]:['/api/agents/toggle','/api/policy/global'],'only intentional denied fixture controls are submitted; no running broker is contacted');
 console.log(JSON.stringify({heartbeat,newMessage:added,maxInflight,stateRequests,fleetRequests}));
 console.log('PASS: loaded-history performance, heartbeat stability, incremental messages, alias scope, live status/membership/policy'+(baseline?' (baseline measurement).':', SSE coalescing, hidden-tab throttling, foreground recovery, selection/navigation and slow-load persisted orbital scope and denied-control recovery.'));
}finally{await browser.close()}
