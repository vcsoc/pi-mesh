import {neighbourhoodLayout} from './topology-layout.mjs';
// The alternative overview keeps the full project graph, with channel/agent
// columns inside each project instead of satellite rings.
export function structuredLayout(agents,channels){
 const base=neighbourhoodLayout(agents,channels),positions=new Map(),regions=[];
 for(const r of base.regions){const points=[...base.positions.values()].filter(p=>p.project===r.key),a=points.filter(p=>p.id.startsWith('agent:')),c=points.filter(p=>p.id.startsWith('channel:')),width=Math.max(650,350+Math.min(4,a.length)*190),height=Math.max(400,Math.max(c.length,Math.ceil(a.length/4))*100+330),local=new Map();local.set(`project:${r.key}`,{x:width/2,y:100,z:0,project:r.key});c.forEach((p,i)=>local.set(p.id,{x:120,y:230+i*100,z:0,project:r.key}));a.forEach((p,i)=>local.set(p.id,{x:350+(i%4)*190,y:230+Math.floor(i/4)*100,z:0,project:r.key}));regions.push({...r,width,height,local});}
 const target=Math.max(1000,Math.sqrt(regions.reduce((sum,r)=>sum+(r.width+100)*(r.height+100),0))*1.2);let x=40,y=40,rowHeight=0,width=240;
 for(const r of regions){if(x>40&&x+r.width>target){x=40;y+=rowHeight+100;rowHeight=0;}r.x=x;r.y=y;for(const[id,p]of r.local)positions.set(id,{...p,x:p.x+x,y:p.y+y});delete r.local;x+=r.width+100;rowHeight=Math.max(rowHeight,r.height);width=Math.max(width,x);}
 return{...base,positions,regions,width,height:y+rowHeight+60};
}
