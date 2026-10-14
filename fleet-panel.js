(() => {
 const get=id=>document.getElementById(id),make=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el};
 let active=false,busy=false,selected='',signature='',receipt=null;
 async function api(path,body) {
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Fleet request failed');return data;
 }
 async function refresh() {
  if(!active||busy||document.hidden)return;busy=true;
  try {
   const {runs}=await api('/api/fleet'),project=get('fleet-project'),current=project.value;
   const projects=[...new Set(runs.map(r=>r.project))].sort();
   if(JSON.stringify(projects)!==project.dataset.projects){project.replaceChildren(new Option('All projects',''),...projects.map(p=>new Option(p,p)));project.value=current;project.dataset.projects=JSON.stringify(projects)}
   const visible=runs.filter(r=>!project.value||r.project===project.value),next=JSON.stringify([project.value,visible.map(r=>[r.id,r.state,r.usage,r.steps.map(s=>s.state),r.nextAt])]);
   if(next!==signature){signature=next;get('fleet-runs').replaceChildren();for(const run of visible){const button=make('button',`${run.id.slice(0,8)} · ${run.state} · ${run.steps.length} steps · ${run.usage?.tokens||0} tokens · est. $${(run.usage?.cost||0).toFixed(4)}\n${run.project}${run.nextAt&&run.state==='scheduled'?`\nNext: ${run.nextAt}`:''}`);button.type='button';button.dataset.run=run.id;button.addEventListener('click',()=>{selected=run.id;void refresh()});get('fleet-runs').append(button)}if(!visible.length)get('fleet-runs').append(make('p','No workflows in this project. Preview and approve a run from /mesh jobs.'))}
   if(selected){const detail=await api(`/api/fleet/run?id=${encodeURIComponent(selected)}`);get('fleet-detail').hidden=false;get('fleet-title').textContent=`${selected} · ${detail.run.state}`;get('fleet-evidence').textContent=JSON.stringify(detail.run,null,2).slice(-64000)+'\n\nEvents (bounded):\n'+detail.events;for(const button of document.querySelectorAll('[data-fleet-action],#fleet-steer'))button.disabled=['completed','failed','cancelled','interrupted'].includes(detail.run.state)}
   if(receipt){try{const result=await api(`/api/fleet/receipt?id=${encodeURIComponent(receipt.runId)}&receipt=${encodeURIComponent(receipt.id)}`);get('fleet-status').textContent=`${result.action}: ${result.state}${result.error?` — ${result.error}`:''}`;receipt=null}catch{/* A queued receipt has not been applied yet. */}}
  }catch(error){get('fleet-status').textContent=error.message}finally{busy=false}
 }
 async function control(action) {
  if(!selected)return;
  try{receipt=await api('/api/fleet/control',{id:selected,action,message:action==='steer'?get('fleet-steering').value:undefined});get('fleet-status').textContent=`${action}: queued (${receipt.id.slice(0,8)}). Waiting for runner acknowledgement…`;if(action==='steer')get('fleet-steering').value='';void refresh()}catch(error){get('fleet-status').textContent=error.message}
 }
 get('fleet-project').addEventListener('change',()=>void refresh());
 for(const button of document.querySelectorAll('[data-fleet-action]'))button.addEventListener('click',()=>void control(button.dataset.fleetAction));
 get('fleet-steer').addEventListener('click',()=>void control('steer'));
 window.addEventListener('mesh-fleet-view',event=>{const changed=active!==event.detail;active=event.detail;if(changed)void refresh()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()});
 setInterval(()=>void refresh(),1500);
})();
