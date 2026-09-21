// Optional browser regression test. Uses fixtures; never connects to a running mesh.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node test/workbench-browser.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const agents = ['Cubed','Haven','Scout'].map((name,i)=>({id:`a${i}`,name,status:['working','idle','offline'][i],enabled:true,activeChannel:i===2?'general':'backend',channels:i===2?['general']:['general','backend'],cwd:'/sample',projectName:'sample',projectHash:'a'.repeat(64),model:'sample-model'}));
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
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],mutations=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route('http://mesh.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/api/state')return route.fulfill({json:state});
  if(route.request().method()==='POST'){mutations.push(pathname);return route.fulfill({json:{}})}
  const files={'/':'dashboard.html','/dashboard.css':'dashboard.css','/dashboard.js':'dashboard.js'};
  if(files[pathname])return route.fulfill({body:await readFile(new URL('../'+files[pathname],import.meta.url)),contentType:pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'text/javascript':'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://mesh.test');await page.waitForSelector('.topology-node');
 assert.equal(await page.locator('.message').count(),8);
 assert.equal(await page.locator('#message-tabs button').first().textContent(),'Membership matrix');
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
 assert.equal(await page.locator('.membership-matrix td').filter({hasText:'★ Active'}).count(),3);
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
 await page.locator('#controls-tab').click();assert.ok(await page.locator('#composer').isVisible());assert.ok(await page.locator('#membership').isVisible());
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
 await page.locator('[data-node="channel:backend"]').click();state.channels=state.channels.filter(c=>c.name!=='backend');state.agents.forEach(a=>{a.channels=['general'];a.activeChannel='general'});
 await page.waitForTimeout(1700);assert.equal(await page.locator('[data-view="channel:backend"]').count(),0);assert.equal(await page.locator('.message').count(),8);
 for(const [width,height] of [[1440,900],[1024,768],[768,800],[390,844]]){
  await page.setViewportSize({width,height});
  const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,footer:document.querySelector('.statusbar').getBoundingClientRect().bottom,height:innerHeight}));
  assert.equal(geometry.overflow,false,`horizontal overflow at ${width}`);assert.equal(Math.round(geometry.footer),geometry.height,`footer at ${width}`);
 }
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'/tmp/mesh-workbench.png',fullPage:true});
 assert.deepEqual(mutations,[],'layout interactions must not mutate broker state');assert.deepEqual(errors,[]);
 console.log('PASS: topology colors/toggle filters, tabs, matrix, polling reconciliation, keyboard/pointer resize, collapse, inspector, responsive footer, CSP, and no unintended mutations.');
} finally { await browser.close(); }
