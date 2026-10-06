import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestScope,scopeProposal,compileScopedWorkflow} from '../team-scope.mjs';
import {teamWorkRequest} from '../team-work.mjs';
import {loadProfiles} from '../workflow.mjs';

test('review, mixed and ambiguous requests stay conservative; explicit build verbs suggest writers',()=>{
 for(const goal of ['review this project','Please audit auth','Review then fix bugs','Explain this code','Investigate the error','Something ambiguous'])assert.equal(requestScope(goal),'review',goal);
 for(const goal of ['Fix the review findings','Please implement this','Can you add tests','continue with completing Arena','Scaffold an initial release'])assert.equal(requestScope(goal),'build',goal);
 const original=teamWorkRequest('review this project'),snapshot=structuredClone(original);
 const review=scopeProposal(()=>original,'review this project');
 assert.deepEqual(original,snapshot);
 assert.deepEqual(review.definition.stages.flatMap(s=>s.tasks.map(t=>t.profile)),['scout','reviewer']);
 assert.equal(review.definition.isolation,'shared');
 assert.ok(!review.definition.stages[1].tasks[0].acceptance[0].equals,'defects do not trigger an implementation loop');
 assert.equal(scopeProposal(teamWorkRequest,'review this project','build').definition.stages.length,4);
});

test('review compiler narrows overridden profiles, tools and writer flags without mutating them',()=>{
 const home=mkdtempSync(join(tmpdir(),'mesh-scope-'));
 try{
  const profiles=loadProfiles(home,home);
  for(const p of Object.values(profiles)){p.write=true;p.tools=['read','bash','edit','write'];}
  const before=structuredClone(profiles),definition=scopeProposal(teamWorkRequest,'review this project').definition;
  const options={agentDir:home,currentModel:'fixture/one',availableModels:['fixture/one'],activeTools:['read','bash','edit','write']};
  const plan=compileScopedWorkflow(definition,profiles,options);
  assert.equal(plan.scope,'review');assert.deepEqual(profiles,before);
  for(const t of plan.stages.flatMap(s=>s.tasks)){assert.equal(t.write,false);assert.deepEqual(t.tools,['read']);assert.equal(t.extensions.length,0);}
  for(const extra of [{extensions:['/not-approved']},{extensionTools:['danger']},{acceptance:[{type:'command',command:'touch unsafe'}]}]){
   const bad=structuredClone(definition);Object.assign(bad.stages[0].tasks[0],extra);
   assert.throws(()=>compileScopedWorkflow(bad,profiles,options),/Review-only scope/);
  }
  assert.throws(()=>compileScopedWorkflow({...definition,scope:'oops'},profiles,options),/Invalid team scope/);
 }finally{rmSync(home,{recursive:true,force:true});}
});
