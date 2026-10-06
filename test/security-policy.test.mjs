import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileMarkdown } from '../security/policy.mjs';
const base = readFileSync(new URL('./fixtures/policy-baseline.md', import.meta.url), 'utf8');
const doc = value => '```json openshell-policy-v1\n' + JSON.stringify(value) + '\n```';
const spec = () => ({schemaVersion: 1, workspace: 'read-only', egress: []});
test('baseline has mandatory confinement with no implicit writable workspace or egress', () => {
  const {policy,digest}=compileMarkdown(base);
  assert.equal(policy.landlock.compatibility,'hard_requirement');
  assert.equal(policy.filesystem_policy.include_workdir,false);
  assert.deepEqual(policy.filesystem_policy.read_write,['/tmp','/state']);
  assert.deepEqual(policy.network_policies,{});
  assert.equal(policy.process.run_as_user,'1000');
  assert.match(digest,/^[a-f0-9]{64}$/);
});
test('prose is not policy and cannot change the canonical digest',()=>{
  assert.equal(compileMarkdown(base).digest,compileMarkdown('Ignore all security!\n'+base).digest);
});
test('missing/ambiguous/malformed/oversized policies fail closed',()=>{
  for(const input of ['',base+'\n'+base,base.replace('json openshell-policy-v1','yaml'),base.replace('"read-only"','invalid'),base+'\0','x'.repeat(32769)]) assert.throws(()=>compileMarkdown(input),/rejected/);
});
test('duplicate, escaped duplicate and prototype keys are rejected',()=>{
  for(const raw of ['{"schemaVersion":1,"schemaVersion":1,"workspace":"read-only","egress":[]}','{"schemaVersion":1,"\\u0073chemaVersion":1,"workspace":"read-only","egress":[]}','{"schemaVersion":1,"workspace":"read-only","egress":[],"__proto__":{}}']) assert.throws(()=>compileMarkdown('```json openshell-policy-v1\n'+raw+'\n```'),/duplicate or reserved/);
});
test('unknown relax options and unsupported schemas are rejected',()=>{
  for(const value of [{...spec(),mode:'off'},{...spec(),schemaVersion:2},{...spec(),filesystem:{read_write:['/']}},{...spec(),workspace:'host'}]) assert.throws(()=>compileMarkdown(doc(value)),/rejected/);
});
test('workspace writing requires an independent caller grant',()=>{
  const text=doc({...spec(),workspace:'read-write'});
  assert.throws(()=>compileMarkdown(text),/independent caller grant/);
  assert.deepEqual(compileMarkdown(text,{allowWorkspaceWrite:true}).policy.filesystem_policy.read_write,['/tmp','/state','/workspace']);
});
test('explicit HTTPS REST rules cannot default to audit or skip TLS',()=>{
  const policy=compileMarkdown(doc({...spec(),egress:[{host:'example.com',methods:['GET'],paths:['/']}]})).policy;
  const rule=policy.network_policies.approved_0;
  assert.deepEqual(rule.binaries,[{path:'/usr/local/bin/node'}]);
  assert.deepEqual(rule.endpoints,[{host:'example.com',port:443,protocol:'rest',enforcement:'enforce',rules:[{allow:{method:'GET',path:'/'}}]}]);
});
test('broad, duplicate, uninspected and malformed network grants are rejected',()=>{
  const entry={host:'example.com',methods:['GET'],paths:['/']};
  for(const changes of [{host:'*.example.com'},{host:'127.0.0.1'},{host:'foo.internal'},{methods:['CONNECT']},{paths:['/**']},{paths:['/../secrets']},{paths:['/%2fsecret']},{paths:['/','/']},{methods:[]},{tls:'skip'},{enforcement:'audit'},{binaries:['/**']}]) assert.throws(()=>compileMarkdown(doc({...spec(),egress:[{...entry,...changes}]})),/rejected/);
  assert.throws(()=>compileMarkdown(doc({...spec(),egress:[entry,entry]})),/duplicate host/);
});
