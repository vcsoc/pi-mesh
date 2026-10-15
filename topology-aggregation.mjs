
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
 const cell=260,grid=new Map(),out=[],largest=Math.max(100,...nodes.map(n=>n.footprint||100));let right=0;
 for(const original of nodes){const n={...original},r=n.footprint||100,origin={x:n.x,y:n.y};let placed=false;
  for(let attempt=0;attempt<2048;attempt++){
   if(attempt){const distance=52*Math.sqrt(attempt),angle=attempt*2.399963229728653;n.x=origin.x+Math.cos(angle)*distance;n.y=origin.y+Math.sin(angle)*distance;}
   const gx=Math.floor(n.x/cell),gy=Math.floor(n.y/cell);let clear=true;for(let x=gx-Math.ceil((r+largest+12)/cell);x<=gx+Math.ceil((r+largest+12)/cell)&&clear;x++)for(let y=gy-Math.ceil((r+largest+12)/cell);y<=gy+Math.ceil((r+largest+12)/cell)&&clear;y++)for(const other of grid.get(`${x}:${y}`)||[])if(Math.hypot(n.x-other.x,n.y-other.y)<r+other.footprint+12-1e-7){clear=false;break}if(clear){placed=true;break}
  }
  if(!placed){n.x=right+r+24;n.y=origin.y}n.footprint=r;right=Math.max(right,n.x+r);const key=`${Math.floor(n.x/cell)}:${Math.floor(n.y/cell)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(n);out.push(n);
 }return out;
}
export function aggregateTopology(model,collapsed=new Set(),cached,{aspect=1}={}){
 const tree=topologyHierarchy(model),{byId,children,parents,roots}=tree,visible=new Set(),counts=new Map();
 const count=id=>{let total=0;for(const child of children.get(id)){total+=1+count(child)}counts.set(id,total);return total};for(const id of roots)count(id);
 const visit=id=>{visible.add(id);if(!collapsed.has(id))for(const child of children.get(id))visit(child)};for(const id of roots)visit(id);
 aspect=Math.max(.25,Math.min(4,Math.round(aspect*20)/20||1));
 const size=id=>{const n=byId.get(id);return n.kind==='project'?Math.min(220,64+(counts.get(id)||0)*14):n.kind==='channel'?Math.min(96,55+Math.sqrt(counts.get(id)||0)*5):Math.min(90,n.renderSize*2)};
 const footprint=id=>byId.get(id).kind==='agent'?114:Math.max(100,size(id)+24);
 const signature=JSON.stringify([model.nodes.map(n=>[n.id,parents.get(n.id)]).sort((a,b)=>a[0].localeCompare(b[0])),[...visible].sort(),aspect]);let positions,width,height;
 if(cached?.signature===signature)({positions,width,height}=cached);else{
  const raw=[];
  // Pack actual occupied island bounds, NOT all roots on one giant orbit.
  // Recentring thin single-channel chains removes their conservative empty disk.
  const islands=roots.map(id=>{const local=[{id,x:0,y:0,footprint:footprint(id)}],descendants=[];const visit=key=>{if(!collapsed.has(key))for(const child of children.get(key)){descendants.push(child);visit(child)}};visit(id);
   // The project hub stays at its cluster's centre. Channel ownership still
   // controls folding, but no longer stretches every small project into a chain.
   const largest=Math.max(100,...descendants.map(footprint));let ring=footprint(id)+largest+28,offset=0;while(offset<descendants.length){const capacity=Math.max(1,Math.floor(Math.PI/Math.asin(Math.min(.999999,(largest+14)/ring)))),batch=descendants.slice(offset,offset+capacity);for(let i=0;i<batch.length;i++){const key=batch[i],angle=-Math.PI/2+i*2*Math.PI/batch.length;local.push({id:key,x:Math.cos(angle)*ring,y:Math.sin(angle)*ring,footprint:footprint(key)})}offset+=batch.length;ring+=2*largest+28}
   let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))>>>0;const angle=hash%12*Math.PI/6;for(const n of local){const x=n.x;n.x=x*Math.cos(angle)-n.y*Math.sin(angle);n.y=x*Math.sin(angle)+n.y*Math.cos(angle)}const nodes=separateTopologyNodes(local),left=Math.min(...nodes.map(n=>n.x-n.footprint)),right=Math.max(...nodes.map(n=>n.x+n.footprint)),top=Math.min(...nodes.map(n=>n.y-n.footprint)),bottom=Math.max(...nodes.map(n=>n.y+n.footprint)),cx=(left+right)/2,cy=(top+bottom)/2;for(const n of nodes){n.x-=cx;n.y-=cy}return{id,nodes,r:Math.max(...nodes.map(n=>Math.hypot(n.x,n.y)+n.footprint))}}).sort((a,b)=>b.r-a.r||a.id.localeCompare(b.id));
  const placed=[];let bounds,shelfX=0,shelfY=0,shelfHeight=0;const shelfWidth=Math.sqrt(islands.reduce((sum,p)=>sum+4*p.r*p.r,0)*aspect)*1.1;
  for(const island of islands){let best;
   // Bound the candidate search for fleets with hundreds of distinct projects.
   // Sparse normal fleets retain tangent packing; large fleets use dense shelves.
   if(islands.length>64){if(shelfX&&shelfX+2*island.r>shelfWidth){shelfX=0;shelfY+=shelfHeight+40;shelfHeight=0}best={x:shelfX+island.r,y:shelfY+island.r};shelfX+=2*island.r+40;shelfHeight=Math.max(shelfHeight,2*island.r)}else if(!placed.length)best={x:0,y:0};else for(const anchor of placed)for(let step=0;step<32;step++){const angle=step*Math.PI/16,distance=anchor.r+island.r+40,x=anchor.x+Math.cos(angle)*distance,y=anchor.y+Math.sin(angle)*distance;if(placed.some(p=>Math.hypot(p.x-x,p.y-y)<p.r+island.r+36))continue;const box={left:Math.min(bounds.left,x-island.r),right:Math.max(bounds.right,x+island.r),top:Math.min(bounds.top,y-island.r),bottom:Math.max(bounds.bottom,y+island.r)},w=box.right-box.left,h=box.bottom-box.top,score=Math.max(w/aspect,h)+.08*(w/aspect+h)+Math.hypot(x,y)*.001;if(!best||score<best.score)best={x,y,score,box}}
   best||={x:bounds.right+island.r+40,y:0};Object.assign(island,best);placed.push(island);bounds={left:Math.min(bounds?.left??Infinity,island.x-island.r),right:Math.max(bounds?.right??-Infinity,island.x+island.r),top:Math.min(bounds?.top??Infinity,island.y-island.r),bottom:Math.max(bounds?.bottom??-Infinity,island.y+island.r)};for(const n of island.nodes)raw.push({...n,x:n.x+island.x,y:n.y+island.y});
  }
  const separated=separateTopologyNodes(raw),left=(separated.length?Math.min(...separated.map(n=>n.x-n.footprint)):0)-60,top=(separated.length?Math.min(...separated.map(n=>n.y-n.footprint)):0)-60;positions=new Map(separated.map(n=>[n.id,{x:n.x-left,y:-(n.y-top),footprint:n.footprint}]));width=(separated.length?Math.max(...separated.map(n=>n.x+n.footprint)):160)-left+60;height=(separated.length?Math.max(...separated.map(n=>n.y+n.footprint)):160)-top+60;
 }
 const nodes=model.nodes.filter(n=>visible.has(n.id)).map(n=>({...n,...positions.get(n.id),renderSize:size(n.id),treeParent:parents.get(n.id),childCount:children.get(n.id).length,descendantCount:counts.get(n.id),expanded:!collapsed.has(n.id),hiddenCount:collapsed.has(n.id)?counts.get(n.id):0}));
 const representative=id=>{while(id&&!visible.has(id))id=parents.get(id);return id},grouped=new Map();
 for(const e of model.edges){const source=representative(e.source),target=representative(e.target);if(!source||!target||source===target)continue;const aggregated=source!==e.source||target!==e.target,key=JSON.stringify([e.kind,...[source,target].sort()]);if(!grouped.has(key))grouped.set(key,{...e,id:aggregated?'aggregate:'+key:e.id,source,target,aggregated,count:0});const edge=grouped.get(key);edge.count++;edge.aggregated||=aggregated;}
 return{...model,nodes,edges:[...grouped.values()],width,height,hierarchy:tree,layoutCache:{signature,positions,width,height},totalNodes:model.nodes.length};
}
