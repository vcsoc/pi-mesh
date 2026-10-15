
// Display ownership is a forest, not membership authority. Real lineage wins;
// otherwise a same-project active channel owns the agent's single visual node.
export function topologyHierarchy(model){
 const byId=new Map(model.nodes.map(n=>[n.id,n])),parents=new Map(),children=new Map(model.nodes.map(n=>[n.id,[]]));
 const homes=new Map();for(const e of model.edges)if(e.kind==='active-membership'&&byId.get(e.source)?.project===byId.get(e.target)?.project)homes.set(e.target,e.source);
 for(const n of model.nodes){let parent;if(n.kind==='channel')parent=`project:${n.project}`;else if(n.kind==='agent'){const actual=n.parent&&byId.get(`agent:${n.parent}`);parent=actual&&actual.id!==n.id&&actual.project===n.project?actual.id:homes.get(n.id)||`project:${n.project}`;}if(parent!==n.id&&byId.has(parent))parents.set(n.id,parent);}
 // Invalid/cyclic historical metadata must never hide an entire component or
 // overflow recursion. The original relationship edges remain untouched.
 for(const n of model.nodes){const seen=new Set([n.id]);let p=parents.get(n.id),depth=0;while(p){if(seen.has(p)||++depth>12){const root=`project:${n.project}`;if(root!==n.id&&byId.has(root))parents.set(n.id,root);else parents.delete(n.id);break}seen.add(p);p=parents.get(p)}}
 for(const [id,parent]of parents)children.get(parent).push(id);for(const list of children.values())list.sort();
 const roots=model.nodes.filter(n=>!parents.has(n.id)).map(n=>n.id).sort();return{byId,parents,children,roots};
}
// Greedy spatial-hash projection also keeps tween frames collision-free. The
// reserved footprint includes node bodies and short labels, not just points.
export function separateTopologyNodes(nodes){
 const cell=260,grid=new Map(),out=[];let right=0;
 for(const original of nodes){const n={...original},r=n.footprint||100,origin={x:n.x,y:n.y};let placed=false;
  for(let attempt=0;attempt<2048;attempt++){
   if(attempt){const distance=52*Math.sqrt(attempt),angle=attempt*2.399963229728653;n.x=origin.x+Math.cos(angle)*distance;n.y=origin.y+Math.sin(angle)*distance;}
   const gx=Math.floor(n.x/cell),gy=Math.floor(n.y/cell);let clear=true;for(let x=gx-1;x<=gx+1&&clear;x++)for(let y=gy-1;y<=gy+1&&clear;y++)for(const other of grid.get(`${x}:${y}`)||[])if(Math.hypot(n.x-other.x,n.y-other.y)<r+other.footprint+12-1e-7){clear=false;break}if(clear){placed=true;break}
  }
  if(!placed){n.x=right+r+24;n.y=origin.y}n.footprint=r;right=Math.max(right,n.x+r);const key=`${Math.floor(n.x/cell)}:${Math.floor(n.y/cell)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(n);out.push(n);
 }return out;
}
export function aggregateTopology(model,collapsed=new Set(),cached){
 const tree=topologyHierarchy(model),{byId,children,parents,roots}=tree,visible=new Set(),counts=new Map();
 const count=id=>{let total=0;for(const child of children.get(id)){total+=1+count(child)}counts.set(id,total);return total};for(const id of roots)count(id);
 const visit=id=>{visible.add(id);if(!collapsed.has(id))for(const child of children.get(id))visit(child)};for(const id of roots)visit(id);
 const signature=JSON.stringify([model.nodes.map(n=>[n.id,parents.get(n.id)]).sort((a,b)=>a[0].localeCompare(b[0])),[...visible].sort()]);let positions,width,height;
 if(cached?.signature===signature)({positions,width,height}=cached);else{
  const disks=new Map(),raw=[];
  const pack=id=>{const kids=collapsed.has(id)?[]:children.get(id),own=100;const parts=kids.map(child=>({id:child,r:pack(child)}));if(!parts.length){disks.set(id,{r:own,parts:[]});return own}
   let ring=parts.length===1?228:Math.max(own+Math.max(...parts.map(p=>p.r))+28,parts.reduce((s,p)=>s+2*p.r+28,0)/(2*Math.PI));while(parts.length>1&&parts.reduce((sum,p)=>sum+2*Math.asin(Math.min(.999999,(p.r+14)/ring)),0)>2*Math.PI)ring*=1.06;
   const arcs=parts.map(p=>parts.length===1?0:2*Math.asin((p.r+14)/ring)),extra=(2*Math.PI-arcs.reduce((a,b)=>a+b,0))/parts.length;let angle=-Math.PI/2;
   parts.forEach((p,i)=>{angle+=arcs[i]/2+extra/2;p.x=Math.cos(angle)*ring;p.y=Math.sin(angle)*ring;angle+=arcs[i]/2+extra/2});const r=ring+Math.max(...parts.map(p=>p.r));disks.set(id,{r,parts});return r;
  };
  // Virtual root packs project islands exactly like sibling subtrees.
  const virtual='\u0000overview';children.set(virtual,roots);pack(virtual);
  const place=(id,x,y)=>{if(id!==virtual)raw.push({id,x,y,footprint:100});for(const part of disks.get(id).parts)place(part.id,x+part.x,y+part.y)};place(virtual,0,0);
  const separated=separateTopologyNodes(raw),left=Math.min(0,...separated.map(n=>n.x))-140,top=Math.min(0,...separated.map(n=>n.y))-140;positions=new Map(separated.map(n=>[n.id,{x:n.x-left,y:-(n.y-top),footprint:n.footprint}]));width=Math.max(280,...separated.map(n=>n.x))-left+140;height=Math.max(280,...separated.map(n=>n.y))-top+140;
 }
 const nodes=model.nodes.filter(n=>visible.has(n.id)).map(n=>({...n,...positions.get(n.id),renderSize:n.kind==='agent'?Math.min(90,n.renderSize*2):n.kind==='project'?80:60,treeParent:parents.get(n.id),childCount:children.get(n.id).length,descendantCount:counts.get(n.id),expanded:!collapsed.has(n.id),hiddenCount:collapsed.has(n.id)?counts.get(n.id):0}));
 const representative=id=>{while(id&&!visible.has(id))id=parents.get(id);return id},grouped=new Map();
 for(const e of model.edges){const source=representative(e.source),target=representative(e.target);if(!source||!target||source===target)continue;const aggregated=source!==e.source||target!==e.target,key=JSON.stringify([e.kind,...[source,target].sort()]);if(!grouped.has(key))grouped.set(key,{...e,id:aggregated?'aggregate:'+key:e.id,source,target,aggregated,count:0});const edge=grouped.get(key);edge.count++;edge.aggregated||=aggregated;}
 return{...model,nodes,edges:[...grouped.values()],width,height,hierarchy:tree,layoutCache:{signature,positions,width,height},totalNodes:model.nodes.length};
}
