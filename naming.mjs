const roles={orchestrator:'orc',developer:'dev',tester:'test',reviewer:'rev',architect:'arch',scout:'scout',researcher:'res',advisor:'adv',auditor:'audit',delegate:'del',planner:'plan',writer:'write',operator:'ops',analyst:'ana',security:'sec'};
const aliases={worker:'developer',dev:'developer',test:'tester',rev:'reviewer',arch:'architect',orc:'orchestrator'};
export function canonicalRole(value='orchestrator') {
 const role=String(value).trim().toLowerCase(),canonical=(Object.hasOwn(aliases,role)?aliases[role]:undefined)||Object.keys(roles).find(k=>roles[k]===role)||role;
 if(!/^[a-z][a-z0-9_-]{0,47}$/.test(canonical))throw Object.assign(new Error('Invalid agent role'),{status:400,code:'INVALID_ROLE'});return canonical;
}
export function roleSuffix(role) {const key=canonicalRole(role);return Object.hasOwn(roles,key)?roles[key]:key.slice(0,8)}
export function roleName(project,role) {
 const prefix=String(project).replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^[^\p{L}\p{N}]+/u,'')||'project';
 return `${prefix.slice(0,32)}-${roleSuffix(role)}`;
}
export function isOffline(agent,now=Date.now()) {return Boolean(agent.removedAt||agent.status==='offline'||now-Number(agent.lastSeenAt||0)>20000)}
export function allocateName(agents,base,id,{explicit=false,now=Date.now(),reclaimOffline=true}={}) {
 for(let n=0;n<10000;n++) {
  const candidate=`${base.slice(0,48-(n?String(n).length:0))}${n||''}`;
  const conflict=Object.values(agents).find(a=>a.id!==id&&a.name.toLowerCase()===candidate.toLowerCase());
  if(!conflict)return {name:candidate};
  if(reclaimOffline&&isOffline(conflict,now))return {name:candidate,reclaim:conflict.id};
  if(explicit)throw Object.assign(new Error(`Agent name is online: ${candidate}`),{status:409,code:'AGENT_NAME_TAKEN'});
 }
 throw new Error('Role name capacity exhausted');
}
