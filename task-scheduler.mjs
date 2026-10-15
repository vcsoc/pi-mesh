// Dependency-driven, work-conserving scheduler. All claims happen synchronously
// before promises start; blocked tasks hold no capacity/resource and are never retried implicitly.
export async function scheduleTasks(tasks,{concurrency=tasks.length,execute,decision=()=>null,stopped=()=>false,onChange=()=>{},wait=()=>new Promise(r=>setTimeout(r,25)),resources=t=>[t.lane||t.id]}={}) {
 const entries=new Map(tasks.map(task=>[task.id,{task,state:'queued',attempt:0}])),running=new Map(),held=new Set();
 const publish=()=>onChange([...entries.values()].map(({task,state,attempt,error})=>({id:task.id,state,attempt,error})));
 const dependencyState=entry=>(entry.task.dependsOn||[]).map(id=>entries.get(id)?.state);
 for(const entry of entries.values())for(const id of entry.task.dependsOn||[])if(!entries.has(id))throw Error(`Unknown dependency ${id}`);
 const visit=(id,path=new Set())=>{if(path.has(id))throw Error('Task dependency cycle');const next=new Set([...path,id]);for(const dep of entries.get(id).task.dependsOn||[])visit(dep,next)};for(const id of entries.keys())visit(id);
 publish();
 while([...entries.values()].some(e=>!['completed','skipped'].includes(e.state))){
  if(stopped()){await Promise.allSettled(running.values());throw Error('Scheduler stopped')}
  for(const entry of entries.values())if(entry.state==='blocked'){
   const command=decision(entry.task,entry.result);
   if(command?.action==='retry'){for(const key of entry.reserved||[])held.delete(key);delete entry.reserved;entry.state='queued';entry.directive=command.message;delete entry.error;publish()}
  }
  for(const entry of entries.values()){
   if(running.size>=concurrency)break;
   if(entry.state!=='queued'||dependencyState(entry).some(s=>!['completed','skipped'].includes(s)))continue;
   const keys=[...new Set(resources(entry.task))];if(keys.some(k=>held.has(k)))continue;
   keys.forEach(k=>held.add(k));entry.state='running';entry.attempt++;publish();
   const promise=Promise.resolve().then(()=>execute(entry.task,entry.directive,entry.attempt)).then(result=>{
    entry.result=result;entry.state=result.state==='completed'?'completed':result.state==='skipped'?'skipped':'blocked';entry.error=result.error;
   },error=>{entry.state='blocked';entry.error=error.message;entry.result={id:entry.task.id,state:'blocked',error:error.message}}).finally(()=>{if(entry.state==='blocked'&&(entry.task.write||entry.task.acceptance?.some(g=>g.type==='command')))entry.reserved=keys;else keys.forEach(k=>held.delete(k));running.delete(entry.task.id);publish()});
   running.set(entry.task.id,promise);
  }
  if([...entries.values()].every(e=>['completed','skipped'].includes(e.state)))break;
  await wait();
 }
 return [...entries.values()].map(e=>e.result);
}

export function taskGraph(plan){
 let previous=[];const tasks=[];
 for(const stage of plan.stages){const stageIds=[];
  for(const task of stage.tasks){const dependsOn=task.dependsOn??(stage.parallel?previous:[...(stageIds.length?[stageIds.at(-1)]:previous)]);tasks.push({...task,dependsOn:[...new Set([...dependsOn,...(stage.when?[stage.when.step]:[])])],when:stage.when,retries:stage.retries});stageIds.push(task.id)}
  previous=stageIds;
 }
 return tasks;
}
