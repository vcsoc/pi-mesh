// Read-only recorded Pi session usage. No model calls, prices, prompts or credentials are returned.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';

const fields=['input','output','cacheCreate','cacheRead','cost'];
const zero=()=>Object.fromEntries(fields.map(k=>[k,0]));
const unknown=()=>Object.fromEntries(fields.map(k=>[k,null]));
const measured=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const add=(total,value)=>{for(const k of fields)total[k]=total[k]===null||value[k]===null?null:total[k]+value[k];};
const invalid=message=>Object.assign(new Error(message),{status:400,code:'INVALID_USAGE_FILTER'});
export function usageFilter(params=new URLSearchParams()){
 const date=params.get('date')||'',start=params.get('start')||'',end=params.get('end')||'',timezone=params.get('timezone')||'UTC';
 const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 for(const key of ['date','start','end','timezone'])if(params.has(key)&&!params.get(key))throw invalid('Usage filters cannot be empty.');
 if(date&&(start||end))throw invalid('Choose either a single date or a start/end range, not both.');
 if((start&&!end)||(end&&!start))throw invalid('Both start and end dates are required.');
 for(const value of [date,start,end].filter(Boolean))if(!valid(value))throw invalid('Dates must be real calendar dates in YYYY-MM-DD format.');
 if(start&&end<start)throw invalid('End date must be on or after start date.');
 let formatter;try{if(timezone.length>100)throw Error();formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});}catch{throw invalid('Unknown time zone.');}
 const zone=formatter.resolvedOptions().timeZone;
 return {start:date||start||null,end:date||end||null,timezone:zone,day:timestamp=>{if(zone==='UTC')return new Date(timestamp).toISOString().slice(0,10);const parts=Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;}};
}
function record(entry){
 const message=entry?.type==='message'?(['assistant','toolResult'].includes(entry.message?.role)?entry.message:null):(['usage','compaction','branch_summary'].includes(entry?.type)?entry:null);if(!message?.usage)return null;
 const time=message.timestamp??entry.timestamp,timestamp=typeof time==='number'?time:Date.parse(time);
 if(!Number.isFinite(timestamp)||!Number.isFinite(new Date(timestamp).getTime()))return {invalidTime:true};
 const u=message.usage,cost=measured(u.cost?.total),components=['input','output','cacheWrite','cacheRead'].map(k=>measured(u.cost?.[k]));
 const metrics={input:measured(u.input),output:measured(u.output),cacheCreate:measured(u.cacheWrite),cacheRead:measured(u.cacheRead),cost:cost??(components.every(v=>v!==null)?components.reduce((a,b)=>a+b,0):null)};
 const provider=typeof message.provider==='string'?message.provider:'unknown',model=typeof message.model==='string'?message.model:'unknown';
 // Copied resume/branch entries keep their entry id, timestamp and usage; bill them once globally.
 const fingerprint=entry.id?createHash('sha256').update(JSON.stringify([entry.id,entry.type,message.role||null,timestamp,provider,model,metrics])).digest('hex'):null;
 return {timestamp,provider,model,metrics,fingerprint};
}
export class UsageStore{
 constructor(){this.cache=new Map();this.days=new Map();this.queue=Promise.resolve();}
 async session(path){
  const info=await stat(path);if(!info.isFile())throw Error('Not a regular session file');
  let cached=this.cache.get(path);
  if(!cached||cached.ino!==info.ino||cached.dev!==info.dev||info.size<cached.offset||(info.size===cached.offset&&info.mtimeMs!==cached.mtime))cached={ino:info.ino,dev:info.dev,offset:0,mtime:0,pending:Buffer.alloc(0),records:[],header:false,first:true,malformed:0,invalidTime:0,unidentified:0};
  if(info.size===cached.offset){cached.mtime=info.mtimeMs;this.cache.delete(path);this.cache.set(path,cached);return cached;}
  // Publish a cache update only after the complete snapshot has been read successfully.
  cached={...cached,records:[...cached.records]};
  let lines=0,fragments=cached.pending.length?[cached.pending]:[],lineBytes=cached.pending.length;
  // Accumulate slices, not growing copies: long tool/image lines must cost O(bytes), not O(bytes²).
  for await(const chunk of createReadStream(path,{start:cached.offset,end:info.size-1})){
   let from=0,index;
   while((index=chunk.indexOf(10,from))!==-1){
    const part=chunk.subarray(from,index);from=index+1;lineBytes+=part.length;if(lineBytes>16*1024*1024)throw Error('Session line exceeds safe read limit');
    const line=(fragments.length?Buffer.concat([...fragments,part],lineBytes):part).toString('utf8').trim();fragments=[];lineBytes=0;if(!line)continue;
    try{const entry=JSON.parse(line);if(cached.first){cached.first=false;cached.header=entry.type==='session';}else if(cached.header){const item=record(entry);if(item?.invalidTime)cached.invalidTime++;else if(item){cached.records.push(item);if(!item.fingerprint)cached.unidentified++;}}}catch{cached.first=false;cached.malformed++;}
    if(++lines%128===0)await yieldTurn();
   }
   if(from<chunk.length){const part=chunk.subarray(from);fragments.push(part);lineBytes+=part.length;if(lineBytes>16*1024*1024)throw Error('Session line exceeds safe read limit');}
  }
  cached.pending=fragments.length?Buffer.concat(fragments,lineBytes):Buffer.alloc(0);
  cached.offset=info.size;cached.mtime=info.mtimeMs;this.cache.delete(path);this.cache.set(path,cached);return cached;
 }
 query(agents,channels,params=new URLSearchParams()){
  const filter=usageFilter(params),snapshot=structuredClone({agents,channels});
  const job=this.queue.then(()=>this.build(snapshot.agents,snapshot.channels,filter));this.queue=job.catch(()=>{});return job;
 }
 async build(agents,channels,filter){
  const projects=new Map(),sources=new Map(),seen=new Set();
  // Coarse UTC bounds safely cover all civil-time offsets; avoid formatting every historical turn for a daily query.
  const lower=filter.start?Date.parse(filter.start+'T00:00:00Z')-2*86400000:-Infinity,upper=filter.end?Date.parse(filter.end+'T00:00:00Z')+3*86400000:Infinity;
  const days=this.days.get(filter.timezone)||new Map();this.days.delete(filter.timezone);this.days.set(filter.timezone,days);while(this.days.size>4)this.days.delete(this.days.keys().next().value);
  let processed=0;
  const coverage={readableSessions:0,unavailableSessions:0,malformedLines:0,invalidTimestamps:0,unidentifiedMessages:0,pendingLines:0,duplicates:0,unknownModels:0};
  // Old registrations own old turns. New resume copies must not reattribute or rebill those turns.
  agents.sort((a,b)=>(Date.parse(a.registeredAt)||0)-(Date.parse(b.registeredAt)||0)||String(a.id).localeCompare(String(b.id)));
  for(const agent of agents){
   const projectId=agent.projectHash||agent.cwd||'unknown',name=agent.projectName||'Unknown project';
   let project=projects.get(projectId);if(!project){project={id:projectId,name,channels:[...new Set(channels.filter(c=>c.projectHash===projectId&&!c.aliasFor).map(c=>c.name))].sort(),agents:new Map()};projects.set(projectId,project);}
   const agentName=agent.previousName||agent.name||agent.role||'Unknown agent',role=agent.role||'orchestrator',agentKey=JSON.stringify([role,agentName]);
   let group=project.agents.get(agentKey);if(!group){group={id:agentKey,name:agentName,role,channels:new Set(),days:new Map(),totals:zero(),available:false};project.agents.set(agentKey,group);}
   for(const name of agent.channels||[])group.channels.add(name);if(agent.activeChannel)group.channels.add(agent.activeChannel);
   if(!agent.sessionFile||!isAbsolute(agent.sessionFile)||!agent.sessionFile.endsWith('.jsonl')){coverage.unavailableSessions++;continue;}
   try{const path=await realpath(agent.sessionFile);if(!sources.has(path))sources.set(path,group);}catch{coverage.unavailableSessions++;}
  }
  for(const [path,group] of sources){
   let session;try{session=await this.session(path);if(!session.header)throw Error('Invalid session header');}catch{coverage.unavailableSessions++;continue;}
   group.available=true;coverage.readableSessions++;coverage.malformedLines+=session.malformed;coverage.invalidTimestamps+=session.invalidTime;coverage.unidentifiedMessages+=session.unidentified;if(session.pending.length)coverage.pendingLines++;
   for(const item of session.records){
    if(++processed%256===0)await yieldTurn();
    if(item.timestamp<lower||item.timestamp>=upper)continue;
    let date=days.get(item.timestamp);if(!date){date=filter.day(item.timestamp);days.set(item.timestamp,date);if(days.size>100000)days.delete(days.keys().next().value);}if(filter.start&&date<filter.start||filter.end&&date>filter.end)continue;
    if(item.fingerprint&&seen.has(item.fingerprint)){coverage.duplicates++;continue;}if(item.fingerprint)seen.add(item.fingerprint);if(item.provider==='unknown'||item.model==='unknown')coverage.unknownModels++;
    let day=group.days.get(date);if(!day){day={date,totals:zero(),models:new Map()};group.days.set(date,day);}
    const key=JSON.stringify([item.provider,item.model]);let model=day.models.get(key);if(!model){model={provider:item.provider,model:item.model,...zero()};day.models.set(key,model);}
    add(model,item.metrics);add(day.totals,item.metrics);add(group.totals,item.metrics);
   }
  }
  // Cache only registered sources, with a bounded memory footprint. Eviction affects speed, not accounting.
  for(const path of this.cache.keys())if(!sources.has(path))this.cache.delete(path);
  while(this.cache.size>512)this.cache.delete(this.cache.keys().next().value);
  const output=[...projects.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).map(project=>({...project,agents:[...project.agents.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.role.localeCompare(b.role)).map(agent=>({...agent,channels:[...agent.channels].sort(),totals:agent.available?agent.totals:unknown(),days:[...agent.days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({...day,models:[...day.models.values()].sort((a,b)=>a.provider.localeCompare(b.provider)||a.model.localeCompare(b.model))}))}))}));
  return {generatedAt:new Date().toISOString(),filter:{start:filter.start,end:filter.end,timezone:filter.timezone},recordedOnly:true,channelAttribution:'Project owns usage; channel filters use recorded registrations/memberships, not historical token destinations.',coverage,projects:output};
 }
}
