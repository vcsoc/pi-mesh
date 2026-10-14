// Deterministic project -> channel -> agent satellite layout. Sigma renders it;
// Graphology owns links. No force simulation, jitter or inferred parent claims.
const order=(a,b)=>String(a.name||a.id).localeCompare(String(b.name||b.id))||String(a.id).localeCompare(String(b.id));
export const projectIdentity=agent=>agent.projectHash||agent.cwd||`unassigned:${agent.id}`;
export function channelIndex(channels){const index=new Map();for(const c of channels)index.set(c.name.toLowerCase(),c);for(const c of channels)for(const name of c.aliases||[])if(!index.has(name.toLowerCase()))index.set(name.toLowerCase(),c);return index;}
function satellites(hub,members){const points=[{id:hub,x:0,y:0,z:0}];let ring=1,slot=0;for(const agent of members){let point;do{const capacity=ring*8,angle=slot*2*Math.PI/capacity;point={id:`agent:${agent.id}`,x:Math.cos(angle)*ring*230,y:Math.sin(angle)*ring*190,z:0};if(++slot===capacity){ring++;slot=0;}}while(points.some(p=>Math.abs(p.x-point.x)<160&&Math.abs(p.y-point.y)<76));points.push(point);}const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));return{points:points.map(p=>({...p,x:p.x-minX+100,y:p.y-minY+100})),width:maxX-minX+200,height:maxY-minY+190};}
export function neighbourhoodLayout(agents,channels){
 const positions=new Map(),groups=new Map(),parentLinks=[],index=channelIndex(channels),owners=new Map();
 const group=(key,label)=>{if(!groups.has(key))groups.set(key,{key,label,agents:[],channels:[]});return groups.get(key);};
 for(const a of [...agents].sort(order))group(projectIdentity(a),a.projectName||a.cwd||'Unassigned project').agents.push(a);
 const memberships=new Map();for(const a of agents){for(const c of new Set((a.channels||[]).map(n=>index.get(n.toLowerCase())).filter(Boolean))){if(!memberships.has(c.name))memberships.set(c.name,new Map());const counts=memberships.get(c.name),key=projectIdentity(a);counts.set(key,(counts.get(key)||0)+1);}}
 for(const c of [...channels].sort(order)){const counts=memberships.get(c.name)||new Map(),key=c.userOnly?'shared-channels':c.projectHash||[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||'shared-channels';owners.set(c.name,key);group(key,key==='shared-channels'?'Shared channels':c.projectName||c.name).channels.push(c);}
 const byAgent=new Map(agents.map(a=>[a.id,a]));for(const a of agents){const parent=byAgent.get(a.parentAgentId);if(parent&&parent.id!==a.id)parentLinks.push([`agent:${parent.id}`,`agent:${a.id}`]);}
 const regions=[];
 for(const g of [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.key.localeCompare(b.key))){
  const buckets=new Map(g.channels.map(c=>[c.name,[]])),loose=[];
  for(const a of g.agents){const active=index.get(String(a.activeChannel||'').toLowerCase()),joined=(a.channels||[]).map(n=>index.get(n.toLowerCase())).filter(Boolean).sort(order),anchor=(active&&owners.get(active.name)===g.key&&joined.includes(active)?active:null)||joined.find(c=>owners.get(c.name)===g.key&&!c.userOnly);if(anchor)buckets.get(anchor.name).push(a);else loose.push(a);}
  const hub=satellites(`project:${g.key}`,loose),clusters=g.channels.map(c=>({name:c.name,...satellites(`channel:${c.name}`,buckets.get(c.name))})),local=new Map();
  let x=0,y=0,rowHeight=0,channelWidth=0;const columns=Math.max(1,Math.ceil(Math.sqrt(clusters.length)));
  clusters.forEach((cluster,i)=>{if(i&&i%columns===0){x=0;y+=rowHeight+100;rowHeight=0;}cluster.x=x;cluster.y=y;x+=cluster.width+100;rowHeight=Math.max(rowHeight,cluster.height);channelWidth=Math.max(channelWidth,x-100);});
  const width=Math.max(320,hub.width,channelWidth)+80,offset=40+(width-80-hub.width)/2;
  for(const p of hub.points)local.set(p.id,{...p,x:p.x+offset,y:p.y+40});
  for(const cluster of clusters)for(const p of cluster.points)local.set(p.id,{...p,x:p.x+40+cluster.x,y:p.y+hub.height+140+cluster.y});
  regions.push({key:g.key,label:g.label,members:g.agents.length,width,height:hub.height+180+(clusters.length?y+rowHeight:0),local});
 }
 const area=regions.reduce((sum,r)=>sum+(r.width+100)*(r.height+100),0),target=Math.max(1000,Math.sqrt(area)*1.2);let x=40,y=40,rowHeight=0,width=240;
 for(const r of regions){if(x>40&&x+r.width>target){x=40;y+=rowHeight+100;rowHeight=0;}r.x=x;r.y=y;for(const [key,p]of r.local)positions.set(key,{...p,x:p.x+x,y:p.y+y,project:r.key});delete r.local;x+=r.width+100;rowHeight=Math.max(rowHeight,r.height);width=Math.max(width,x);}
 return{positions,regions,parentLinks,width,height:y+rowHeight+60,orbits:[]};
}
