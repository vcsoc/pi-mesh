import test from 'node:test';import assert from 'node:assert/strict';
import {completionReport,runControlRequest} from '../completion.mjs';import {createRunStatus} from '../run-status.mjs';
test('budget cancellation reports partial work and cannot claim completed scaffold',()=>{
 const r={id:'11111111-1111-4111-8111-111111111111',state:'cancelled',error:'Run usage budget reached',project:'/arena',usage:{tokens:218772,cost:0.1498},steps:[{id:'plan',state:'completed',output:'Plan'},{id:'implement',state:'cancelled'}]};
 const s=completionReport(r);assert.match(s,/NOT VERIFIED \/ INCOMPLETE/);assert.match(s,/Run usage budget reached/);assert.match(s,/Partial edits/);assert.match(s,/218772/);
 assert.deepEqual(runControlRequest(`steer ${r.id} Keep the release local`),{action:'steer',id:r.id,message:'Keep the release local'});
 assert.throws(()=>runControlRequest(`steer ${r.id}`),/instruction/);assert.equal(runControlRequest('list'),null);
});
test('observer delivers newly launched terminal reports once, not old history, and never invokes controls',()=>{
 let run={id:'11111111-1111-4111-8111-111111111111',project:'/fixture',state:'running',steps:[],usage:{}},finished=[];
 const ctx={hasUI:true,cwd:'/fixture',ui:{setStatus(){}}};
 const o=createRunStatus({directory:()=>'/mock',projectOf:c=>c.cwd,list:()=>[run],read:()=>run,schedule:()=>1,unschedule(){},onFinish:r=>finished.push(r)});
 o.start(ctx);assert.equal(finished.length,0);o.track(run,ctx);run={...run,state:'cancelled'};o.tick();o.tick();assert.equal(finished.length,1);o.stop();
 o.start(ctx);assert.equal(finished.length,1);o.stop();
});
