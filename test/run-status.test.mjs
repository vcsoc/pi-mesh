import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunStatus,runStatusText} from '../run-status.mjs';

const fixture=()=>({id:'54a27b09-ddd0-4b8d-9456-e87103dfdf13',project:'/project',state:'running',steps:[{id:'inspect',profile:'scout',state:'running',activity:'thinking',output:'PRIVATE OUTPUT MUST NOT APPEAR'}],usage:{tokens:85023,cost:0.408718}});
test('footer reports actual runtime, activity and estimated usage, never claims acceptance or shows output',()=>{
 const run=fixture();assert.match(runStatusText(run),/54a27b09.*RUNNING.*scout\/thinking.*85.0k tok.*~\$0.409/);
 for(const state of ['paused','failed','cancelled','interrupted'])assert.match(runStatusText({...run,state}),new RegExp(state.toUpperCase()));
 const text=runStatusText({...run,state:'completed'});assert.match(text,/FINISHED · see results/);assert.doesNotMatch(text,/PRIVATE|verified|passed/i);
 assert.doesNotMatch(runStatusText({...run,id:'\x1b]evil\x07',steps:[{profile:'\x1b[31mx\n',state:'running'}]}),/[\x00-\x1f\x7f]/);
});
test('observer restores, follows background state, handles unavailable data and cleans up without controls',()=>{
 let run=fixture(),callback,scheduled=0,cleared=0,broken=false;
 const updates=[],ctx={hasUI:true,cwd:'/project',ui:{setStatus:(key,text)=>updates.push({key,text})}};
 const observer=createRunStatus({directory:()=>'/fixture',projectOf:c=>c.cwd,list:()=>[run],read:()=>{if(broken)throw Error('gone');return run;},schedule:fn=>{callback=fn;scheduled++;return 1;},unschedule:()=>cleared++});
 assert.equal(scheduled,0);observer.start(ctx);assert.match(updates.at(-1).text,/RUNNING/);
 observer.start(ctx);assert.equal(scheduled,1);
 run={...run,state:'paused'};callback();assert.match(updates.at(-1).text,/PAUSED/);
 broken=true;callback();assert.match(updates.at(-1).text,/unavailable.*no action/);
 broken=false;run={...run,state:'completed'};callback();assert.match(updates.at(-1).text,/FINISHED/);
 observer.stop();assert.equal(cleared,1);assert.equal(updates.at(-1).text,undefined);
 const count=updates.length;callback();assert.equal(updates.length,count);
 assert.ok(updates.every(u=>u.key==='agent-mesh-work'));
});
test('observer never displays another project or creates timers for a non-UI client',()=>{
 let scheduled=0,text;const run=fixture();
 const observer=createRunStatus({directory:()=>'/fixture',projectOf:c=>c.cwd,list:()=>[run],read:()=>run,schedule:()=>++scheduled,unschedule:()=>{}});
 observer.start({hasUI:false});assert.equal(scheduled,0);
 observer.start({hasUI:true,cwd:'/other',ui:{setStatus:(_key,value)=>{text=value;}}});assert.equal(text,undefined);
 observer.stop();
});
