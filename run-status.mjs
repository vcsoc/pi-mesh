import {plain} from './work-review.mjs';
const terminal=new Set(['completed','failed','cancelled','interrupted']);
const compact=value=>plain(value).replace(/\s+/g,' ').slice(0,32);
export function runStatusText(run,extra=0){
 const step=(run.steps||[]).find(s=>s.state==='running')||(run.steps||[]).at(-1);
 const states={starting:'STARTING',queued:'QUEUED',scheduled:'SCHEDULED',running:'RUNNING',paused:'PAUSED',completed:'FINISHED · see results',failed:'FAILED · inspect error',cancelled:'CANCELLED',interrupted:'INTERRUPTED · inspect before resuming'};
 const tokens=Number.isFinite(run.usage?.tokens)?run.usage.tokens:0;
 const cost=Number.isFinite(run.usage?.cost)?`~$${run.usage.cost.toFixed(3)}`:'cost unknown';
 const activity=run.state==='running'&&['working','thinking','waiting'].includes(step?.activity)?`/${step.activity}`:'';
 return `Mesh ${compact(run.id).slice(0,8)} · ${states[run.state]||'UNKNOWN'}${step?` · ${compact(step.profile||step.id)}${activity}`:''} · ${tokens>=1000?(tokens/1000).toFixed(1)+'k':tokens} tok · ${cost}${extra?` · +${extra} active`:''}`;
}

// Read-only observer: never launches, resumes, controls, reads conversations or
// replaces another extension's footer. No timers until start/track is called.
export function createRunStatus({directory,projectOf,list,read,schedule=setInterval,unschedule=clearInterval,onFinish=()=>{}}){
 let context,project,watched,timer,frame=0,lastText,activeCount=0;
 const launched=new Set();
 const publish=text=>{if(text!==lastText){try{context?.ui?.setStatus?.('agent-mesh-work',text);}catch{}lastText=text;}};
 const tick=()=>{
  if(!context)return;
  try{
   for(const id of [...launched]){
    const run=read(directory(),id,false);
    if(run.project!==project){launched.delete(id);continue;}
    if(terminal.has(run.state)){onFinish(run,context);launched.delete(id);}
   }
   let current=watched?read(directory(),watched,true):undefined;
   if(current&&current.project!==project){watched=undefined;current=undefined;}
   if(!current||terminal.has(current.state)||frame++%5===0){
    const runs=list(directory(),project).filter(r=>r.project===project),active=runs.filter(r=>!terminal.has(r.state));activeCount=active.length;
    if(!current||terminal.has(current.state)&&active.length)current=active[0]||runs[0];
    watched=current?.id;
   }
   publish(current?runStatusText(current,Math.max(0,activeCount-1)):undefined);
  }catch{publish('Mesh · status unavailable — no action taken');}
 };
 const stop=()=>{if(timer!==undefined)unschedule(timer);timer=undefined;publish(undefined);context=undefined;project=undefined;watched=undefined;lastText=undefined;launched.clear();};
 const start=ctx=>{
  if(!ctx?.hasUI||typeof ctx.ui?.setStatus!=='function')return;
  let next;try{next=projectOf(ctx);}catch{stop();context=ctx;publish('Mesh · status unavailable — no action taken');return;}
  if(project!==next){stop();project=next;}
  context=ctx;tick();
  if(timer===undefined){timer=schedule(tick,1000);timer?.unref?.();}
 };
 const track=(run,ctx)=>{start(ctx);if(!context||run.project!==project)return;watched=run.id;launched.add(run.id);publish(runStatusText(run));tick();};
 return {start,track,stop,tick};
}
