import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobs, profiles } from '../orchestration.mjs';
async function fixture(t, createSession, options = {}) {
 const directory=await mkdtemp(join(tmpdir(),'mesh-jobs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const jobs=createJobs({directory,createSession,...options});t.after(()=>jobs.close());return {jobs,directory};
}
const session = output => ({ messages: [], subscribe:()=>()=>{}, prompt:async()=>{}, getLastAssistantText:()=>output, abort:async()=>{}, dispose(){} });
test('roles distinguish read-only analysis from writing and persist completed evidence',async t=>{
 assert.equal(profiles.reviewer.write,false);assert.equal(profiles.worker.write,true);
 const {jobs,directory}=await fixture(t,async()=>session('evidence'));
 const job=jobs.start({profile:'reviewer',task:'Review'}),result=await job.done;
 assert.equal(result.state,'completed');assert.equal(result.output,'evidence');
 assert.equal(JSON.parse(await readFile(join(directory,job.id+'.json'),'utf8')).state,'completed');
});
test('concurrency queues, steering and stop are lifecycle-aware',async t=>{
 let release,started=0,steered='';
 const {jobs}=await fixture(t,async()=>({...session('done'),prompt:()=>{started++;return new Promise(r=>release=r)},abort:async()=>release?.(),steer:async s=>{steered=s}}),{concurrency:1});
 const first=jobs.start({task:'first'}),second=jobs.start({task:'second'});
 while(!started)await new Promise(r=>setTimeout(r,5));
 assert.equal(started,1);assert.equal(jobs.list()[1].state,'queued');
 await jobs.steer(first.id,'narrow scope');assert.equal(steered,'narrow scope');
 await jobs.stop(second.id);assert.equal((await second.done).state,'cancelled');
 await jobs.stop(first.id);assert.equal((await first.done).state,'cancelled');
});
test('failed children and spawn budgets fail closed',async t=>{
 const {jobs}=await fixture(t,async()=>{throw new Error('model unavailable')},{budget:1});
 const first=jobs.start({task:'work'});assert.throws(()=>jobs.start({task:'extra'}),/budget/);
 assert.equal((await first.done).state,'failed');
 assert.throws(()=>jobs.start({profile:'unknown',task:'work'}),/Unknown role/);
});
test('shutdown cancels queued work and rejects future starts',async t=>{
 const {jobs}=await fixture(t,async()=>session('done'),{concurrency:0});
 const job=jobs.start({task:'queued'});await jobs.close();
 assert.equal((await job.done).state,'cancelled');assert.throws(()=>jobs.start({task:'after'}),/closed/);
});
