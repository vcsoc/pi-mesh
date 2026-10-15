(() => {
 const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
 const columns=['Backlog','To Do','In Progress','Testing','Done'];
 let project='',board=null,selected='',busy=false,signature='',ticket=0,receipt=null,mutating=false;
 async function api(path,payload){const response=await fetch(path,payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}:{cache:'no-store',signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Task request failed');return result}
 function status(text){if($('kanban-status').textContent!==text)$('kanban-status').textContent=text}
 function working(value){mutating=value;document.querySelectorAll('#kanban-create button,#kanban-comment-form button,#kanban-ready,#kanban-answer,#kanban-retry,#kanban-escalate').forEach(button=>button.disabled=value)}
 function detail(){
  const task=board?.tasks.find(t=>t.id===selected),panel=$('kanban-detail');panel.hidden=!task;if(!task)return;
  $('kanban-task-title').textContent=task.title;$('kanban-task-description').textContent=task.description;
  $('kanban-task-meta').textContent=`${task.column} · ${task.owner||task.profile||'Unassigned'} · revision ${task.version}${task.runId?' · run '+task.runId:''}`;
  $('kanban-blocker').textContent=task.blocker?`Needs ${task.blocker.level} decision: ${task.blocker.question}${task.blocker.answer?'\nAnswer: '+task.blocker.answer:''}`:'';
  $('kanban-ready').hidden=task.column!=='Backlog';$('kanban-answer').hidden=!task.blocker;$('kanban-retry').hidden=!task.blocker||!task.runId;$('kanban-escalate').hidden=!task.blocker||!task.runId;
  const comments=$('kanban-comments'),next=JSON.stringify(task.comments);if(comments.dataset.signature!==next){comments.dataset.signature=next;comments.replaceChildren(...task.comments.map(comment=>{const article=node('article');article.append(node('b',comment.author+' · '+comment.kind),node('p',comment.text),node('small',comment.at));return article}))}
 }
 function render(){
  const lanes=$('kanban-lanes');let cursor=lanes.firstElementChild;
  // Retain card DOM and focus on unchanged polling ticks.
  for(const column of columns){let lane=[...lanes.children].find(n=>n.dataset.column===column);if(!lane){lane=node('section');lane.className='kanban-lane';lane.dataset.column=column;lane.append(node('h3'),node('div'));lanes.append(lane)}
   const tasks=board.tasks.filter(t=>t.column===column);lane.firstChild.textContent=`${column} (${tasks.length})`;
   const container=lane.lastChild,existing=new Map([...container.children].map(n=>[n.dataset.task,n]));let position=container.firstElementChild;
   for(const task of tasks){let card=existing.get(task.id);if(!card){card=node('button');card.type='button';card.className='kanban-card';card.dataset.task=task.id;card.onclick=()=>{selected=task.id;detail()}}
    const key=JSON.stringify([task.version,task.blocker]);if(card.dataset.signature!==key){card.dataset.signature=key;card.replaceChildren(node('b',task.title),node('small',task.owner||task.profile),node('span',task.blocker?'⚠ Needs '+task.blocker.level+' decision':task.comments.length+' comments'));card.classList.toggle('blocked',!!task.blocker)}
    if(card===position)position=position.nextElementSibling;else container.insertBefore(card,position);existing.delete(task.id);
   }for(const card of existing.values())card.remove();
  }detail();
 }
 async function refresh(){
  if(!project||busy||mutating||document.hidden||$('kanban-panel').hidden)return;busy=true;const current=project,requestTicket=ticket;
  try{const next=await api('/api/tasks?projectHash='+encodeURIComponent(project));if(current!==project||requestTicket!==ticket)return;board=next;if(JSON.stringify(next)!==signature){signature=JSON.stringify(next);render()}
   if($('kanban-status').textContent==='Loading project tasks…')status('Project board connected. Execution claims and Done require supervisor evidence.');
   if(receipt){try{const applied=await api(`/api/fleet/receipt?id=${encodeURIComponent(receipt.runId)}&receipt=${encodeURIComponent(receipt.id)}`);if(current!==project||requestTicket!==ticket)return;status(`${applied.action}: ${applied.state}${applied.error?' — '+applied.error:''}`);if(['applied','rejected'].includes(applied.state))receipt=null}catch{}}
  }catch(error){if(current===project&&requestTicket===ticket)status(error.message)}finally{busy=false}
 }
 async function mutate(action){
  const task=board?.tasks.find(t=>t.id===selected);if(!task||mutating)return;
  const message=$('kanban-comment').value.trim();if(['comment','answer','retry'].includes(action)&&!message)return status('Write a comment or decision first.');
  const current=project,requestTicket=++ticket;working(true);
  try{
   if(['retry','escalate'].includes(action)&&task.runId){const next=await api('/api/fleet/control',{id:task.runId,action:'decide',taskId:task.stepId,decision:action,message});if(current!==project||requestTicket!==ticket)return;receipt=next;status('Decision queued; not yet applied. Await runner receipt.');}
   else{const next=await api('/api/tasks',{projectHash:project,id:task.id,version:task.version,action,message});if(current!==project||requestTicket!==ticket)return;board=next;signature='';render();status(action==='comment'?'Comment saved. Active child receives it on its next steering boundary; saved is not proof of application.':action==='answer'?'Answer recorded. Retry within remaining grant is a separate decision; exhausted grants need fresh approval.':'Task updated.');}
   if(['comment','answer'].includes(action)&&selected===task.id&&$('kanban-comment').value.trim()===message)$('kanban-comment').value='';
  }catch(error){if(current===project&&requestTicket===ticket){status(error.message+' On uncertain delivery, inspect before resubmitting.');signature='';void refresh()}}finally{working(false)}
 }
 $('kanban-project').onchange=()=>window.dispatchEvent(new CustomEvent('mesh-project-select',{detail:$('kanban-project').value}));
 window.addEventListener('mesh-project-state',event=>{const {projects,selectedProject}=event.detail,select=$('kanban-project');const names=JSON.stringify(projects);if(select.dataset.signature!==names){select.dataset.signature=names;select.replaceChildren(new Option('Choose a project…',''),...projects.map(p=>new Option(p.name,p.hash)))}
  if(project!==selectedProject){project=selectedProject||'';ticket++;selected='';board=null;signature='';receipt=null;$('kanban-lanes').replaceChildren();$('kanban-detail').hidden=true;status(project?'Loading project tasks…':'Double-click a project node or choose a project.');$('kanban-create').hidden=!project;void refresh()}select.value=project;
 });
 window.addEventListener('mesh-kanban-view',()=>void refresh());
 $('kanban-task-close').onclick=()=>{selected='';detail()};
 for(const action of ['ready','answer','retry','escalate'])$('kanban-'+action).onclick=()=>void mutate(action);
 $('kanban-comment-form').onsubmit=event=>{event.preventDefault();void mutate('comment')};
 $('kanban-create').onsubmit=async event=>{event.preventDefault();if(!project||mutating)return;const current=project,requestTicket=++ticket,title=$('kanban-new-title').value,description=$('kanban-new-description').value;working(true);try{const next=await api('/api/tasks',{projectHash:project,action:'create',title,description:description||title});if(current!==project||requestTicket!==ticket)return;board=next;if($('kanban-new-title').value===title)$('kanban-new-title').value='';if($('kanban-new-description').value===description)$('kanban-new-description').value='';signature='';render();status('Backlog task created. Refine to To Do; execution still requires a reviewed approval in Pi.')}catch(error){if(current===project&&requestTicket===ticket)status(error.message+' On uncertain delivery, inspect before resubmitting.')}finally{working(false)}};
 setInterval(()=>void refresh(),750);
})();
