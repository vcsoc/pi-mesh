// Usage is fetched only on opening this panel or explicit Refresh, never on every heartbeat.
(() => {
 const get=id=>document.getElementById(id),make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node};
 let report=null,active=false,ticket=0,controller=null;
 const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 get('usage-date').value=today;get('usage-start').value=today;get('usage-end').value=today;
 get('usage-timezone').textContent=`Dates use ${timezone}. Range endpoints are included. Costs are provider-reported estimates in USD, not invoices. — means unavailable.`;
 const number=value=>value===null?'—':Number(value).toLocaleString();
 const money=value=>value===null?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
 function cells(row,date,metrics,models){for(const text of [date,number(metrics.input),number(metrics.output),number(metrics.cacheCreate),number(metrics.cacheRead),money(metrics.cost),models])row.append(make('td',text));return row;}
 function render(){
  if(!report)return;const output=get('usage-results'),selected=get('usage-project').value,channel=get('usage-channel').value;output.replaceChildren();let count=0;
  for(const project of report.projects){if(selected&&project.id!==selected)continue;const agents=project.agents.filter(a=>!channel||a.channels.includes(channel)||project.channels.includes(channel));if(!agents.length)continue;
   const section=make('section',undefined,'usage-project'),title=make('h3',`PROJECT: ${project.name}`);title.title=project.id;section.append(title,make('p',`Channels: ${project.channels.map(c=>'#'+c).join(', ')||'No recorded project channel'}`,'muted'));
   for(const agent of agents){const role=agent.role.charAt(0).toUpperCase()+agent.role.slice(1),heading=make('h4',`AGENT: ${role} · ${agent.name}`);section.append(heading);const table=make('table',undefined,'usage-table');table.setAttribute('aria-label',`${project.name}: ${agent.name} daily usage`);const thead=make('thead'),head=make('tr');for(const label of ['DATE','INPUT','OUTPUT','CACHE_CR','CACHE_RD','COST','MODELS']){const th=make('th',label);th.scope='col';head.append(th)}thead.append(head);const tbody=make('tbody');
    for(const day of agent.days){for(const model of day.models)tbody.append(cells(make('tr'),day.date,model,`${model.provider}/${model.model}`));if(day.models.length>1)tbody.append(cells(make('tr',undefined,'usage-subtotal'),`${day.date} subtotal`,day.totals,`${day.models.length} provider/model combinations`));}
    if(!agent.days.length){const row=make('tr'),cell=make('td',agent.available?'No recorded usage for these dates.':'No readable registered session; usage is unavailable.');cell.colSpan=7;row.append(cell);tbody.append(row);}
    const foot=make('tfoot');foot.append(cells(make('tr'),'TOTAL',agent.totals,''));table.append(thead,tbody,foot);const scroll=make('div',undefined,'usage-table-scroll');scroll.append(table);section.append(scroll);count++;
   }output.append(section);
  }
  if(!count)output.append(make('p','No registered agents match this project/channel.','empty'));
  const c=report.coverage,issues=[];if(c.unavailableSessions)issues.push(`${c.unavailableSessions} registrations have no readable session`);if(c.malformedLines)issues.push(`${c.malformedLines} malformed records omitted`);if(c.invalidTimestamps)issues.push(`${c.invalidTimestamps} records have no valid timestamp`);if(c.pendingLines)issues.push(`${c.pendingLines} unfinished transcript lines not yet counted`);if(c.unknownModels)issues.push(`${c.unknownModels} usage records lack exact provider/model attribution`);if(c.unidentifiedMessages)issues.push(`${c.unidentifiedMessages} messages lack an entry ID; copied-history deduplication is unavailable for them`);
  get('usage-status').textContent=`${report.filter.start===report.filter.end&&report.filter.start?report.filter.start:report.filter.start?`${report.filter.start} through ${report.filter.end}`:'All dates'} · ${report.filter.timezone} · ${c.readableSessions} sessions · ${c.duplicates} copied entries counted once · updated ${new Date(report.generatedAt).toLocaleTimeString()}${issues.length?`. Partial coverage: ${issues.join('; ')}.`:'.'}`;
 }
 function options(){const project=get('usage-project'),channel=get('usage-channel'),p=project.value,c=channel.value;project.replaceChildren(new Option('All projects',''),...report.projects.map(item=>new Option(item.name,item.id)));project.value=[...project.options].some(o=>o.value===p)?p:'';const names=[...new Set(report.projects.flatMap(p=>[...p.channels,...p.agents.flatMap(a=>a.channels)]))].sort();channel.replaceChildren(new Option('All channels',''),...names.map(name=>new Option('#'+name,name)));channel.value=names.includes(c)?c:'';}
 async function load(){
  const id=++ticket;controller?.abort();controller=new AbortController();get('usage-status').textContent='Reading recorded session usage…';get('usage-refresh').disabled=true;
  const params=new URLSearchParams({timezone});if(get('usage-mode').value==='day')params.set('date',get('usage-date').value);else{params.set('start',get('usage-start').value);params.set('end',get('usage-end').value);}
  try{const response=await fetch('/api/usage?'+params,{cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error?.message||'Usage request failed');if(id!==ticket)return;report=data;options();render();}
  catch(error){if(id===ticket&&error.name!=='AbortError'){get('usage-results').replaceChildren();report=null;get('usage-status').textContent=error.message;}}
  finally{if(id===ticket)get('usage-refresh').disabled=false;}
 }
 function mode(){const single=get('usage-mode').value==='day';get('usage-single').hidden=!single;get('usage-range').hidden=single;get('usage-date').required=single;get('usage-date').disabled=!single;for(const id of ['usage-start','usage-end']){get(id).required=!single;get(id).disabled=single;}}
 get('usage-mode').addEventListener('change',mode);mode();
 get('usage-form').addEventListener('submit',event=>{event.preventDefault();void load()});
 for(const id of ['usage-project','usage-channel'])get(id).addEventListener('change',render);
 window.addEventListener('mesh-usage-view',event=>{const opened=event.detail&&!active;active=event.detail;if(opened&&!report)void load()});
})();
