// Optional isolated browser coverage backed by the real usage parser; no running Mesh or model calls.
import assert from 'node:assert/strict';
import {topologyAssets} from './topology-assets.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageStore } from '../usage.mjs';
const root=resolve(process.env.MESH_DASHBOARD_ROOT||fileURLToPath(new URL('..',import.meta.url)));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const dir=await mkdtemp(join(tmpdir(),'mesh-usage-browser-')),session=join(dir,'sample.jsonl');
const names=['orchestrator','developer'],agents=names.map((role,i)=>({id:`a${i}`,name:`sample-${role}`,role,generation:1,status:'idle',enabled:true,effectiveEnabled:true,activeChannel:i?'other':'sample',channels:[i?'other':'sample'],cwd:'/fixture',projectName:i?'other':'sample',projectHash:String(i+1).repeat(64),sessionFile:i?join(dir,'missing.jsonl'):session,model:'fixture/model',configurable:false})),channels=['sample','other'].map((name,i)=>({name,projectHash:agents[i].projectHash,memberCount:1,memberNames:[agents[i].name]}));
const entries=['2026-01-01','2026-01-02','2026-01-02','2026-01-03'].map((date,i)=>({type:'message',id:`e${i}`,timestamp:date+'T12:00:00Z',message:{role:'assistant',provider:i===2?'openai':'anthropic',model:i===2?'second':'fixture',usage:{input:10,output:4,cacheWrite:2,cacheRead:8,cost:{total:.025}}}}));
await writeFile(session,[{type:'session',id:'fixture'},...entries].map(e=>JSON.stringify(e)).join('\n')+'\n');const store=new UsageStore();
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'UTC'}),errors=[],requests=[],posts=[],expectedHttpErrors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){if(m.text().includes('400 (Bad Request)')&&m.location().url.includes('/api/usage'))expectedHttpErrors.push(m.text());else errors.push(m.text())}});
 await page.addInitScript(()=>{window.EventSource=class{close(){}}});
 await page.route('http://mesh.test/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(route.request().method()==='POST'){posts.push(path);return route.fulfill({json:{}})}
  if(path==='/api/state')return route.fulfill({json:{agents,channels,messages:[],totalMessages:0,policy:{enabled:true,blockedProjects:[]}}});
  if(path==='/api/usage'){requests.push(Object.fromEntries(url.searchParams));try{return route.fulfill({json:await store.query(agents,channels,url.searchParams)})}catch(error){return route.fulfill({status:400,json:{error:{message:error.message}}})}}
  const files={...topologyAssets,'/':'dashboard.html','/dashboard.js':'dashboard.js','/topology-layout.mjs':'topology-layout.mjs','/dashboard.css':'dashboard.css','/fleet-panel.js':'fleet-panel.js','/usage-panel.js':'usage-panel.js','/management-workbench.js':'management-workbench.js','/management-workbench.css':'management-workbench.css','/policy-schema.mjs':'security/policy-schema.mjs'};
  if(files[path])return route.fulfill({body:await readFile(resolve(root,files[path])),contentType:path.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(path)?'text/javascript':'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://mesh.test');await page.waitForSelector('[data-view="usage"]');assert.equal(requests.length,0,'hidden usage never scans sessions');
 await page.locator('[data-view="usage"]').click();await page.waitForSelector('.usage-table');assert.equal(requests.length,1);assert.equal(await page.locator('#timeline-main').isVisible(),false);assert.equal(await page.locator('#top-thread').textContent(),'Daily agent usage');
 await page.locator('#usage-date').fill('2026-01-02');await page.locator('#usage-refresh').click();await page.waitForFunction(()=>document.querySelector('#usage-status').textContent.startsWith('2026-01-02'));
 assert.deepEqual(requests.at(-1),{timezone:'UTC',date:'2026-01-02'});const sample=page.locator('.usage-project').filter({hasText:'PROJECT: sample'});assert.match(await sample.textContent(),/AGENT: Orchestrator/);assert.equal(await sample.locator('.usage-table tbody tr').count(),3,'two models and one daily subtotal');assert.match(await sample.locator('tfoot').textContent(),/TOTAL208416\$0\.05/);assert.match(await sample.textContent(),/anthropic\/fixture/);assert.match(await sample.textContent(),/openai\/second/);assert.equal(await page.locator('.usage-project').filter({hasText:'PROJECT: other'}).locator('tfoot td').nth(5).textContent(),'—');
 await page.locator('#usage-mode').selectOption('range');assert.equal(await page.locator('#usage-date').isDisabled(),true);await page.locator('#usage-start').fill('2026-01-01');await page.locator('#usage-end').fill('2026-01-03');await page.locator('#usage-refresh').click();await page.waitForFunction(()=>document.querySelector('#usage-status').textContent.includes('2026-01-01 through 2026-01-03'));assert.deepEqual(requests.at(-1),{timezone:'UTC',start:'2026-01-01',end:'2026-01-03'});assert.equal(await sample.locator('tfoot td').nth(1).textContent(),'40');assert.equal(await sample.locator('tfoot td').nth(5).textContent(),'$0.10');
 const before=requests.length;await page.waitForTimeout(1700);assert.equal(requests.length,before,'routine state polling does not re-read usage');
 await page.locator('#usage-project').selectOption(agents[0].projectHash);assert.equal(await page.locator('.usage-project').count(),1);await page.locator('#usage-project').selectOption('');await page.locator('#usage-channel').selectOption('other');assert.equal(await page.locator('.usage-project').count(),1);assert.match(await page.locator('#usage-results').textContent(),/PROJECT: other/);assert.equal(requests.length,before,'local project/channel filters do not scan files');await page.locator('#usage-channel').selectOption('');
 await page.locator('[data-view="all"]').click();await page.locator('[data-view="usage"]').click();assert.equal(requests.length,before,'tab switching keeps report and filters');assert.equal(await page.locator('#usage-start').inputValue(),'2026-01-01');
 await page.locator('#usage-end').fill('2025-12-31');await page.locator('#usage-refresh').click();await page.waitForFunction(()=>document.querySelector('#usage-status').textContent.includes('End date must'));assert.equal(await page.locator('.usage-table').count(),0,'invalid filter cannot leave misleading old totals');
 await page.locator('#usage-end').fill('2026-01-03');agents[0].projectName='<img src=x onerror=alert(1)>';agents[0].name='<script>evil()</script>';await page.locator('#usage-refresh').click();await page.waitForSelector('.usage-table');assert.equal(await page.locator('#usage-results img,#usage-results script').count(),0);assert.match(await page.locator('#usage-results').textContent(),/<script>evil/);
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`usage does not overflow ${width}`);assert.equal(await page.locator('#usage-refresh').isVisible(),true);}
 assert.equal(expectedHttpErrors.length,1,'only the intentional invalid-range request fails');assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);console.log('PASS: lazy daily Usage tab, inclusive range endpoints, exact model/provider rows, agent/day totals, unknown costs, project/channel filters, stable polling/navigation, date errors, CSP/XSS and responsive layout; no mutations or inference.');
}finally{await browser.close();await rm(dir,{recursive:true,force:true})}
