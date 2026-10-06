import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { diagnoseMesh } from '../doctor.mjs';

test('doctor is read-only, reports missing or mismatched broker and does not leak token',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'mesh-doctor-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const configPath=join(dir,'config.json'),model='fake/model',project=dir;
 const missing=await diagnoseMesh({configPath,version:'2.7.0',project,model});
 assert.equal(missing.ok,false);assert.equal(existsSync(configPath),false);
 const token='x'.repeat(64),dataDir=join(dir,'data');mkdirSync(dataDir);
 writeFileSync(configPath,JSON.stringify({host:'127.0.0.1',port:47831,token,dataDir}));
 const health={ok:true,version:'2.7.0',instance:createHash('sha256').update(token).digest('hex').slice(0,16)};
 const good=await diagnoseMesh({configPath,version:'2.7.0',project,model,agent:{name:'mypi-orc',activeChannel:'mypi'},fetchHealth:async()=>({ok:true,json:async()=>health})});
 assert.equal(good.ok,true);assert.ok(good.checks.every(check=>check.status==='PASS'));
 assert.equal(JSON.stringify(good).includes(token),false);assert.deepEqual(readdirSync(dataDir),[]);
 const stale=await diagnoseMesh({configPath,version:'2.8.0',project,model,fetchHealth:async()=>({ok:true,json:async()=>health})});
 assert.equal(stale.ok,false);assert.match(stale.checks.find(check=>check.name==='broker').detail,/differs/);
 const offline=await diagnoseMesh({configPath,version:'2.7.0',project,model,fetchHealth:async()=>{throw new Error('refused')}});
 assert.equal(offline.ok,false);assert.match(offline.checks.find(check=>check.name==='broker').detail,/unavailable/);
});
