// Optional browser regression test. Uses fixtures; never connects to a running mesh.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node test/workbench-browser.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const agents = ['Cubed','Haven','Scout'].map((name,i)=>({id:`a${i}`,name,generation:1,status:['working','idle','offline'][i],enabled:true,activeChannel:i===2?'general':'backend',channels:i===2?['general']:['general','backend'],cwd:'/sample',projectName:'sample',projectHash:'a'.repeat(64),model:'sample-provider/first',thinkingLevel:'off',configurable:true}));
const channels = ['general','backend'].map(name=>({name,memberCount:agents.filter(a=>a.channels.includes(name)).length,memberNames:agents.filter(a=>a.channels.includes(name)).map(a=>a.name)}));
const messages = [
 {id:1,fromAgentId:'a0',fromName:'Cubed',fromType:'agent',destination:{type:'channel',id:'backend',name:'backend'},recipientAgentIds:['a1'],content:'Backend coordination'},
 {id:2,fromAgentId:'a2',fromName:'Scout',fromType:'agent',destination:{type:'channel',id:'general',name:'general'},recipientAgentIds:[],content:'General coordination'},
 {id:3,fromAgentId:null,fromName:'You',fromType:'user',destination:{type:'agent',id:'a0',name:'Cubed'},recipientAgentIds:['a0'],content:'Direct intervention'},
 {id:4,fromAgentId:'a0',fromName:'Cubed',fromType:'agent',scopeChannel:'backend',destination:{type:'agent',id:'a1',name:'Haven'},recipientAgentIds:['a1'],content:'Direct backend coordination'},
 {id:5,fromAgentId:'a1',fromName:'Haven',fromType:'agent',scopeChannel:'BACKEND',destination:{type:'all',id:null,name:'All agents'},recipientAgentIds:['a0'],content:'Broadcast backend coordination'},
 {id:6,fromAgentId:'a0',fromName:'Cubed',fromType:'agent',scopeChannel:'general',destination:{type:'agent',id:'a1',name:'Haven'},recipientAgentIds:['a1'],content:'Historical general coordination'},
 {id:7,fromAgentId:'a0',fromName:'Cubed',fromType:'agent',destination:{type:'agent',id:'a1',name:'Haven'},recipientAgentIds:['a1'],content:'Legacy unknown channel'},
 {id:8,fromAgentId:null,scopeAgentId:'a0',fromName:'User',fromType:'user',scopeChannel:'backend',destination:{type:'agent',id:'a1',name:'Haven'},recipientAgentIds:['a1'],content:'Scoped slash intervention'},
].map(m=>({...m,kind:'message',timestamp:'2026-01-01T10:00:00Z'}));
const state={agents,channels,messages,totalMessages:messages.length,policy:{enabled:true,blockedProjects:[]}};
const fleetRun={id:'11111111-1111-4111-8111-111111111111',project:'/sample',state:'running',steps:[{id:'scan',state:'running',output:'<script>unsafe()</script>'}],usage:{tokens:42,cost:0},workspaces:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],mutations=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route('http://mesh.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/api/state')return route.fulfill({json:state});
  if(pathname==='/api/fleet')return route.fulfill({json:{runs:[fleetRun]}});
  if(pathname==='/api/fleet/run')return route.fulfill({json:{run:fleetRun,events:'fixture event'}});
  if(pathname==='/api/agents/config'&&route.request().method()==='GET')return route.fulfill({json:{models:[{id:'sample-provider/first',levels:['off','low']},{id:'sample-provider/second',levels:['off','low']}],request:null,agent:agents.find(a=>a.id===new URL(route.request().url()).searchParams.get('agentId'))}});
  if(pathname==='/api/agents/config'&&route.request().method()==='POST'){mutations.push(pathname);const body=route.request().postDataJSON();state.agents.find(a=>a.id===body.agentId).configuration={id:'fixture-config',state:'pending',model:body.model,thinkingLevel:body.thinkingLevel};return route.fulfill({status:202,json:{request:{id:'fixture-config'}}})}
  if(pathname==='/api/events')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
  if(route.request().method()==='POST'){mutations.push(pathname);return route.fulfill({json:{}})}
  const files={'/':'dashboard.html','/help':'help.html','/dashboard.css':'dashboard.css','/dashboard.js':'dashboard.js','/fleet-panel.js':'fleet-panel.js','/management-workbench.js':'management-workbench.js','/management-workbench.css':'management-workbench.css','/policy-schema.mjs':'security/policy-schema.mjs'};
  if(files[pathname])return route.fulfill({body:await readFile(new URL('../'+files[pathname],import.meta.url)),contentType:pathname.endsWith('.css')?'text/css':(pathname.endsWith('.js')||pathname.endsWith('.mjs'))?'text/javascript':'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://mesh.test');await page.waitForSelector('.topology-node');
 assert.equal(await page.locator('.message').count(),8);
 assert.equal(await page.locator('#mesh-controls .section-toggle').getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#membership .section-toggle').getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#membership .section-toggle').textContent(),'Agent access');
 for(const id of ['channel-panel','participant-panel']){await page.locator(`#${id} .section-toggle`).click();assert.equal(await page.locator(`#${id}`).evaluate(n=>n.classList.contains('section-collapsed')),true);await page.locator(`#${id} .section-toggle`).click()}
 const originalGraph=await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().width);
 await page.locator('#topology-canvas').hover();await page.mouse.wheel(0,-80);await page.waitForTimeout(100);
 assert.ok(await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().width)>originalGraph,'wheel zooms in');
 const zoomed=await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().width);
 await page.locator('#topology-canvas').dispatchEvent('wheel',{deltaY:80,ctrlKey:true});assert.ok(await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().width)<zoomed,'trackpad wheel zooms out');await page.locator('#topology-fit').click();
 await page.locator('#topology-canvas').evaluate(node=>{node.dispatchEvent(new Event('gesturestart',{cancelable:true}));const event=new Event('gesturechange',{cancelable:true});Object.defineProperty(event,'scale',{value:1.25});node.dispatchEvent(event);node.dispatchEvent(new Event('gestureend',{cancelable:true}))});
 assert.ok(await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().width)>originalGraph,'Safari gesture handler zooms');await page.locator('#topology-fit').click();
 assert.ok(await page.locator('.topology-node').evaluateAll(nodes=>new Set(nodes.map(n=>n.style.left)).size)>2,'graph is spatial, not two columns');
 await page.locator('#topology-layout').selectOption('orbital');assert.equal(await page.locator('#topology-layout').inputValue(),'spatial','orbital requires an explicit channel');
 await page.locator('[data-node="channel:backend"]').click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForTimeout(300);assert.equal(await page.locator('.topology-node.sun').count(),1,JSON.stringify({errors,mode:await page.locator('#topology-layout').inputValue(),nodes:await page.locator('.topology-node').evaluateAll(ns=>ns.map(n=>n.dataset.node))}));assert.equal(await page.locator('.topology-node.planet').count(),2);assert.equal(await page.locator('[data-node="channel:general"]').count(),0);assert.equal(await page.locator('#topology-system-label').textContent(),'Solar system · #backend · 2 agents');assert.equal(await page.locator('.topology-graph line').count(),2,'system includes active and secondary memberships');await page.locator('.thread-row').filter({hasText:'#general'}).click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForFunction(()=>document.querySelector('#topology-system-label')?.textContent.includes('#general'));assert.equal(await page.locator('.topology-node.planet').count(),3);assert.equal(await page.locator('[data-node="channel:backend"]').count(),0);await page.locator('.thread-row').filter({hasText:'#backend'}).click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForFunction(()=>document.querySelector('#topology-system-label')?.textContent.includes('#backend'));await page.locator('#topology-overview').click();assert.equal(await page.locator('.topology-node.sun').count(),0);assert.equal(await page.locator('.topology-node').count(),5,'overview restores all nodes');await page.locator('#topology-layout').selectOption('structured');await page.locator('[data-node="channel:general"]').click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForSelector('.topology-node.sun');await page.locator('#topology-overview').click();assert.equal(await page.locator('#topology-layout').inputValue(),'structured','overview returns to the previous layout');await page.locator('#topology-layout').selectOption('spatial');
 await page.locator('[data-node="agent:a0"]').click({button:'right'});assert.ok(await page.getByRole('menuitem',{name:'Send user intervention…'}).isVisible());
 await page.getByRole('menuitem',{name:'Configure Cubed…'}).click();await page.waitForSelector('#agent-config-panel:not([hidden])');assert.equal(await page.locator('#agent-config-model').inputValue(),'sample-provider/first');
 assert.equal(await page.locator('[data-view="config"]').count(),1);await page.screenshot({path:'/tmp/mesh-config-form.png'});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'agent form does not overflow mobile view');await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Close agent configuration tab'}).click();assert.equal(await page.locator('[data-view="config"]').count(),0);
 await page.locator('.person[data-agent="a0"]').click({button:'right'});await page.getByRole('menuitem',{name:'Configure Cubed…'}).click();await page.waitForSelector('#agent-config-panel:not([hidden])');await page.getByRole('button',{name:'Close agent configuration tab'}).click();
 await page.locator('[data-node="channel:backend"]').click({button:'right'});assert.ok(await page.getByRole('menuitem',{name:'Close #backend…'}).isVisible());await page.keyboard.press('Escape');
 await page.locator('[data-node="channel:backend"]').click();
 const tabClose=await page.locator('[data-view="channel:backend"]').evaluate(tab=>{const button=tab.getBoundingClientRect(),close=tab.parentElement.querySelector('.close-tab').getBoundingClientRect();return close.left>=button.left&&close.right<=button.right&&close.top>=button.top&&close.bottom<=button.bottom});assert.equal(tabClose,true,'close button is visually within its tab on the right');
 await page.getByRole('button',{name:'Close #backend tab (keep channel)',exact:true}).click();
 assert.equal(await page.locator('[data-view="channel:backend"]').count(),0);assert.ok(await page.locator('[data-node="channel:backend"]').isVisible());
 await page.waitForTimeout(1700);assert.equal(await page.locator('[data-view="channel:backend"]').count(),0,'closed tab stays closed on refresh');
 assert.equal(await page.locator('#message-tabs button').first().textContent(),'Membership matrix');
 await page.locator('[data-view="fleet"]').click();await page.waitForSelector('[data-run]');
 assert.equal(await page.locator('#fleet-panel').isVisible(),true);await page.locator('[data-run]').click();await page.waitForSelector('#fleet-detail:not([hidden])');
 assert.match(await page.locator('#fleet-evidence').textContent(),/fixture event/);assert.equal(await page.locator('#fleet-evidence script').count(),0);
 await page.locator('[data-view="all"]').click();
 for(const [status,color] of [['working','rgb(34, 107, 58)'],['idle','rgb(154, 80, 22)'],['offline','rgb(80, 80, 86)']])assert.equal(await page.locator('.topology-node.'+status).evaluate(n=>getComputedStyle(n).backgroundColor),color);
 await page.locator('[data-node="channel:backend"]').click();assert.equal(await page.locator('.message').count(),4);
 assert.equal(await page.locator('.thread-row').filter({hasText:'#backend'}).locator('.thread-count').textContent(),'4');
 assert.equal(await page.locator('.message').filter({hasText:'Legacy unknown channel'}).count(),0);
 assert.equal(await page.locator('.message').filter({hasText:'Historical general coordination'}).count(),0);
 assert.equal(await page.locator('[data-view="channel:backend"]').count(),1);
 await page.locator('[data-node="channel:backend"]').click();assert.equal(await page.locator('.message').count(),8);
 await page.locator('[data-node="agent:a0"]').click();assert.equal(await page.locator('.message').count(),7);
 assert.ok(await page.locator('.message').filter({hasText:'Direct intervention'}).count());
 await page.locator('[data-node="agent:a0"]').click();assert.equal(await page.locator('.message').count(),8);
 await page.locator('[data-view="matrix"]').click();assert.ok(await page.locator('#matrix-panel').isVisible());
 await page.locator('.thread-row').filter({hasText:'#backend'}).click();assert.ok(await page.locator('#timeline-main').isVisible());
 assert.equal(await page.locator('[data-view="channel:backend"]').count(),1);
 await page.waitForTimeout(1700);assert.equal(await page.locator('.message').count(),4);
 await page.locator('[data-view="matrix"]').click();await page.waitForTimeout(1700);assert.ok(await page.locator('#matrix-panel').isVisible());
 assert.equal(await page.locator('.membership-matrix tbody tr').count(),3);
 assert.equal(await page.locator('.membership-matrix td').filter({hasText:'★ Selected'}).count(),3);
 assert.equal(await page.locator('#top-thread').textContent(),'Membership matrix');
 assert.equal(await page.locator('.membership-matrix .matrix-current').count(),3);
 assert.equal(await page.locator('.topology-graph line.active-membership').count(),3);
 assert.equal(await page.locator('.topology-graph line.inactive-membership').count(),2);
 await page.locator('.membership-matrix thead button').filter({hasText:'#general'}).click();
 assert.equal(await page.locator('.message').count(),2,'general includes historical direct messages even though the sender is now active in backend');
 await page.locator('.message').filter({hasText:'Historical general coordination'}).locator('.message-channel').click();
 assert.equal(await page.locator('.message').count(),2);
 await page.locator('[data-view="all"]').click();
 const separator=page.locator('#topology-resizer');await separator.focus();const before=Number(await separator.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowRight');assert.equal(Number(await separator.getAttribute('aria-valuenow')),before+20);
 const box=await separator.boundingBox();await page.mouse.move(box.x+3,box.y+100);await page.mouse.down();await page.mouse.move(box.x+63,box.y+100);await page.mouse.up();assert.ok(Number(await separator.getAttribute('aria-valuenow'))>before+20);
 await page.locator('#topology-toggle').click();assert.equal(await page.locator('#topology-toggle').getAttribute('aria-expanded'),'false');
 await page.locator('#topology-toggle').click();assert.equal(await page.locator('#topology-toggle').getAttribute('aria-expanded'),'true');
 await page.locator('#inspector-toggle').click();assert.ok(await page.locator('.workspace.inspector-collapsed').count());assert.equal(await page.locator('#inspector-body').isVisible(),false);await page.locator('#inspector-toggle').click();
 await page.keyboard.press('Alt+t');assert.ok(await page.locator('.workspace.focus-topology').count());assert.equal(await page.locator('.message-workspace').isVisible(),false);
 await page.keyboard.press('Alt+m');assert.ok(await page.locator('.workspace.focus-messages').count());assert.equal(await page.locator('.topology-panel').isVisible(),false);
 await page.keyboard.press('Alt+r');assert.ok(await page.locator('.topology-panel').isVisible());assert.ok(await page.locator('.message-workspace').isVisible());assert.ok(await page.locator('.intervention').isVisible());
 await page.locator('#controls-tab').click();assert.ok(await page.locator('#composer').isVisible());assert.ok(await page.locator('#membership').isVisible());
 for(const id of ['mesh-controls','composer','membership']){const expanded=await page.locator(`#${id} .section-toggle`).getAttribute('aria-expanded');await page.locator(`#${id} .section-toggle`).click();assert.notEqual(await page.locator(`#${id} .section-toggle`).getAttribute('aria-expanded'),expanded);await page.locator(`#${id} .section-toggle`).click()}
 await page.locator('#explorer-tab').click();assert.ok(await page.locator('#threads').isVisible());
 // Membership updates and removals reconcile topology, matrix, and open tabs.
 state.agents[1].status='working';state.agents[1].activeChannel='general';
 await page.waitForTimeout(1700);assert.ok(await page.locator('[data-node="agent:a1"].working').count());
 await page.locator('[data-view="matrix"]').click();
 assert.equal(await page.locator('.membership-matrix tr[data-agent="a1"] .matrix-current').textContent(),'#general');
 assert.equal(await page.locator('.membership-matrix tr[data-agent="a1"] td.active-membership').count(),1);
 assert.equal(await page.locator('.topology-graph line.active-membership[data-agent="a1"]').getAttribute('data-channel'),'general');
 await page.screenshot({path:'/tmp/mesh-matrix-fixture.png'});
 await page.locator('[data-view="all"]').click();
 await page.locator('[data-node="channel:backend"]').click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForSelector('.topology-node.sun');
 await page.locator('[data-node="channel:backend"]').click();state.channels=state.channels.filter(c=>c.name!=='backend');state.agents.forEach(a=>{a.channels=['general'];a.activeChannel='general'});
 await page.waitForTimeout(1700);assert.equal(await page.locator('[data-view="channel:backend"]').count(),0);assert.equal(await page.locator('.message').count(),8);assert.equal(await page.locator('#topology-layout').inputValue(),'spatial','removed system returns to overview');
 for(const [width,height] of [[1440,900],[1024,768],[768,800],[390,844]]){
  await page.setViewportSize({width,height});
  const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,footer:document.querySelector('.statusbar').getBoundingClientRect().bottom,height:innerHeight}));
  assert.equal(geometry.overflow,false,`horizontal overflow at ${width}`);assert.equal(Math.round(geometry.footer),geometry.height,`footer at ${width}`);
 }
 await page.setViewportSize({width:1440,height:900});
 for(let i=3;i<25;i++)state.agents.push({...state.agents[0],id:`a${i}`,name:`Agent ${i}`,status:'idle'});
 state.agents[0].status='working';state.agents[0].activity='thinking';
 await page.waitForTimeout(1700);
 await page.locator('.thread-row').filter({hasText:'#general'}).click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForSelector('.topology-node.sun');assert.equal(await page.locator('.topology-node.sun').count(),1);assert.equal(await page.locator('.topology-node.planet').count(),25,'secondary channel members are planets too');assert.equal(await page.locator('[data-node="channel:backend"]').count(),0);await page.locator('#topology-overview').click();
 const labelsDoNotOverlap=()=>page.locator('.topology-node b').evaluateAll(labels=>labels.every((node,i)=>labels.every((other,j)=>{if(i>=j)return true;const a=node.getBoundingClientRect(),b=other.getBoundingClientRect();return a.right<=b.left+.5||b.right<=a.left+.5||a.bottom<=b.top+.5||b.bottom<=a.top+.5})));
 for(const mode of ['spatial','structured','orbital']){await page.locator('#topology-layout').selectOption(mode);assert.equal(await labelsDoNotOverlap(),true,`${mode} labels must not overlap`);assert.equal(await page.locator('.topology-node').count(),mode==='orbital'?26:state.agents.length+state.channels.length)}
 assert.ok(await page.locator('.topology-graph .sun').count());assert.ok(await page.locator('.topology-graph .planet').count());assert.ok(await page.locator('.orbit-ring').count());
 const animatedStart=await page.locator('[data-node="agent:a0"]').evaluate(n=>n.style.left);await page.waitForTimeout(360);assert.notEqual(await page.locator('[data-node="agent:a0"]').evaluate(n=>n.style.left),animatedStart,'planets animate around their suns');
 await page.emulateMedia({reducedMotion:'reduce'});const reducedPosition=await page.locator('[data-node="agent:a0"]').evaluate(n=>n.style.left);await page.waitForTimeout(320);assert.equal(await page.locator('[data-node="agent:a0"]').evaluate(n=>n.style.left),reducedPosition,'reduced motion pauses orbit');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('#topology-orbit-toggle').click();assert.equal(await page.locator('#topology-orbit-toggle').getAttribute('aria-pressed'),'false');assert.equal(await labelsDoNotOverlap(),true,'animated orbital layout remains collision-free');
 const beforeOrbit=await page.locator('[data-node="agent:a0"]').evaluate(n=>n.style.left);await page.locator('#topology-canvas').focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.locator('[data-node="agent:a0"]').evaluate(n=>n.style.left),beforeOrbit,'keyboard rotates orbital view');
 await page.locator('#topology-search').fill('Scout');assert.equal(await page.locator('[data-node="agent:a2"].search-match').count(),1);assert.equal(await page.locator('[data-node="channel:general"].search-connected').count(),1);assert.ok(await page.locator('.topology-node.faded').count());await page.locator('#topology-search').fill('');await page.screenshot({path:'/tmp/mesh-orbital.png'});
 await page.locator('#topology-layout').selectOption('spatial');await page.locator('[data-view="matrix"]').click();
 assert.equal(await page.locator('tr[data-agent="a0"] .matrix-status').textContent(),'Thinking');
 const beforeZoom=await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().height);
 await page.locator('#topology-zoom-in').click();assert.ok(await page.locator('.topology-graph').evaluate(n=>n.getBoundingClientRect().height)>beforeZoom);
 await page.locator('#topology-fit').click();
 const fit=await page.evaluate(()=>{const c=document.querySelector('#topology-canvas').getBoundingClientRect();return [...document.querySelectorAll('.topology-node')].every(n=>{const b=n.getBoundingClientRect();return b.top>=c.top&&b.bottom<=c.bottom&&b.left>=c.left&&b.right<=c.right})});assert.equal(fit,true,'fit must show every node');
 await page.locator('.matrix-scroll').evaluate(n=>n.scrollTop=500);
 const header=await page.locator('.membership-matrix thead th').first().boundingBox(),scroller=await page.locator('.matrix-scroll').boundingBox();assert.ok(Math.abs(header.y-scroller.y)<2,'header pins to dedicated scroller top');
 state.agents[0].activity='working';await page.waitForTimeout(1700);assert.equal(await page.locator('.matrix-scroll').evaluate(n=>n.scrollTop),500,'status updates preserve scroll');
 // Guided Help stays inside the app and never exercises management actions.
 await page.locator('#help-tour').click();assert.ok(await page.locator('#mesh-tour').evaluate(n=>n.open));
 assert.equal(await page.locator('#tour-previous').isDisabled(),true);
 await page.keyboard.press('ArrowRight');assert.match(await page.locator('#tour-title').textContent(),/topology/);
 await page.keyboard.press('ArrowLeft');assert.match(await page.locator('#tour-title').textContent(),/Welcome/);
 for(let i=1;i<16;i++){await page.locator('#tour-next').click();assert.equal(await page.locator('#tour-progress').textContent(),`Step ${i+1} of 16`)}
 assert.equal(await page.locator('#tour-next').isDisabled(),true);
 await page.locator('#tour-previous').click();assert.match(await page.locator('#tour-title').textContent(),/verify/);
 await page.locator('#tour-exit').click();assert.equal(await page.locator('#mesh-tour').evaluate(n=>n.open),false);
 await page.waitForFunction(()=>document.querySelector('[data-view="matrix"]').getAttribute('aria-selected')==='true');
 assert.equal(await page.locator('.matrix-scroll').evaluate(n=>n.scrollTop),500);
 assert.equal(await page.locator('#help-tour').evaluate(n=>n===document.activeElement),true);
 await page.locator('#inspector-toggle').click();await page.locator('#view-messages').click();await page.locator('#help-tour').click();assert.equal(await page.locator('.workspace.focus-topology').count(),0);await page.locator('#tour-exit').click();await page.waitForFunction(()=>document.querySelector('.workspace.focus-messages.inspector-collapsed'));await page.locator('#view-reset').click();
 await page.setViewportSize({width:390,height:844});await page.locator('#help-tour').click();
 for(let i=0;i<16;i++){
  const box=await page.locator('#tour-card').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=391&&box.y+box.height<=845,'tour stays on screen');
  if(i<15)await page.keyboard.press('ArrowRight');
 }
 await page.keyboard.press('Escape');assert.equal(await page.locator('#mesh-tour').evaluate(n=>n.open),false);
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'/tmp/mesh-workbench.png',fullPage:true});
 await page.goto('http://mesh.test/help');await page.waitForSelector('#mesh-tour[open]');
 assert.equal(new URL(page.url()).searchParams.has('tour'),false,'tutorial URL flag is consumed');
 await page.keyboard.press('Tab');assert.equal(await page.locator('#tour-exit').evaluate(n=>n===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#tour-next').evaluate(n=>n===document.activeElement),true);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('#mesh-tour').open);
 assert.deepEqual(mutations,[],'layout interactions must not mutate broker state');
 await page.locator('[data-node="agent:a0"]').click({button:'right'});await page.getByRole('menuitem',{name:'Configure Cubed…'}).click();await page.locator('#agent-config-model').fill('sample-provider/second');await page.locator('#agent-config-thinking').selectOption('low');await page.locator('#agent-config-reviewed').check();await page.locator('#agent-config-form button[type=submit]').click();
 assert.deepEqual(mutations,['/api/agents/config'],'model configuration is queued only after explicit submission');await page.waitForFunction(()=>/Waiting|queued/.test(document.querySelector('#agent-config-status').textContent));
 await page.getByRole('button',{name:'Close agent configuration tab'}).click();
 await page.getByRole('button',{name:'Close #general channel (keep history and project files)',exact:true}).click();
 assert.deepEqual(mutations,['/api/agents/config','/api/channels/close'],'only explicit configuration and channel close mutate the broker');
 state.channels=state.channels.filter(c=>c.name!=='general');state.agents.forEach(a=>{a.channels=a.channels.filter(name=>name!=='general');if(a.activeChannel==='general')a.activeChannel=''});
 state.channels.push({name:'user',userOnly:true,memberCount:state.agents.length,memberNames:[]});await page.waitForTimeout(1700);
 assert.equal(await page.getByRole('button',{name:'Close #user channel (keep history and project files)',exact:true}).count(),0);
 await page.locator('[data-node="channel:user"]').click({button:'right'});assert.equal(await page.getByRole('menuitem',{name:'Close #user…'}).count(),0);await page.keyboard.press('Escape');
 for(let i=25;i<110;i++)state.agents.push({...state.agents[0],id:`a${i}`,name:`Agent ${i}`,status:'idle'});
 for(let i=0;i<3;i++){const name=`system-${i}`;state.channels.push({name,memberCount:0,memberNames:[]});for(let j=i*25;j<(i+1)*25;j++){state.agents[j].channels=[name];state.agents[j].activeChannel=name}};
 await page.waitForTimeout(1700);await page.locator('[data-node="channel:system-1"]').click({button:'right'});await page.getByRole('menuitem',{name:'Show system'}).click();await page.waitForFunction(()=>document.querySelector('#topology-system-label')?.textContent.includes('#system-1'));assert.equal(await page.locator('.topology-node.planet').count(),25);await page.locator('#topology-overview').click();for(const mode of ['spatial','structured','orbital']){await page.locator('#topology-layout').selectOption(mode);assert.equal(await labelsDoNotOverlap(),true,`${mode} must remain collision-free with 110 agents`);if(mode==='orbital'){assert.equal(await page.locator('.topology-node.sun').count(),1);assert.equal(await page.locator('.topology-node.planet').count(),25);assert.equal(await page.locator('[data-node="channel:user"]').count(),0)}}
 await page.reload();await page.waitForSelector('[data-node="channel:system-1"].sun');assert.equal(await page.locator('.topology-node.planet').count(),25,'the selected system survives dashboard refresh');assert.equal(await page.locator('[data-node="channel:user"]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: 110-node overviews, single-channel solar systems via both context menus, inactive member planets, system switching/removal/refresh, nonoverlap, orbit navigation/search, config tab, panel shortcuts, tutorial, responsive layout and only explicit mutations.');
} finally { await browser.close(); }
