import { circularProjectLayout, projectIdentity } from './topology-layout.mjs';
import { topologyModel } from './topology-model.mjs';
import { TopologyRenderer } from './topology-renderer.mjs';
const $=id=>document.getElementById(id);
const el={agents:$("agents"),agentCount:$("agent-count"),auto:$("auto-scroll"),connection:$("connection"),content:$("content"),fontDown:$("font-down"),fontLevel:$("font-level"),fontUp:$("font-up"),form:$("composer"),jump:$("jump-latest"),kind:$("kind"),latestLabel:$("latest-label"),loadOlder:$("load-older"),messages:$("messages"),status:$("composer-status"),theme:$("theme-toggle"),threadCount:$("thread-count"),threads:$("threads"),timeline:$("timeline-main"),to:$("to"),topMessageCount:$("top-message-count"),topThread:$("top-thread"),membership:$("membership"),memberAgent:$("member-agent"),memberChannel:$("member-channel"),channelOptions:$("channel-options"),joinChannel:$("join-channel"),leaveChannel:$("leave-channel"),removeAgent:$("remove-agent"),membershipStatus:$("membership-status"),contextMenu:$("context-menu"),meshEnabled:$("mesh-enabled"),meshStatus:$("mesh-status"),policyProject:$("policy-project"),projectHash:$("project-hash"),toggleProject:$("toggle-project"),kickAll:$("kick-all"),kickAllStatus:$("kick-all-status")};
let agents=[],channels=[],messages=[],policy={enabled:true,blockedProjects:[],blockedProjectNames:{}},total=0,polling=false,refreshAgain=false,participantStatus="all",selectedParticipant="",selectedChannel="",selectedMessageId=0,lastVisibleMessageId=0;
// Heartbeats change telemetry, not the rendered UI. Keep history and channel lookup work out of that hot path.
let messageRevision=0,channelIndexRevision=0,channelIndexSignature='',countSignature='',renderedMessagesSignature='',renderedSelectedMessageId=0,renderedVisibleMessagesCount=0,agentUISignature='',channelsUISignature='',policyUISignature='',refreshTimer=null,stateLoaded=false;
const messageRecords=new Map(),messageSignatures=new Map(),messageRows=new Map(),channelAliases=new Map(),channelByKey=new Map(),normalizedChannels=new Map(),channelCounts=new Map();
function updateChannelIndex(){const signature=JSON.stringify(channels.map(c=>[c.name,c.aliases]));if(signature===channelIndexSignature)return;channelIndexSignature=signature;channelIndexRevision++;channelAliases.clear();channelByKey.clear();normalizedChannels.clear();for(const c of channels){const key=c.name.toLocaleLowerCase('en-US');channelByKey.set(key,c);for(const alias of c.aliases||[])channelAliases.set(String(alias).toLocaleLowerCase('en-US'),key)}}
function scheduleRefresh(delay=120){if(document.hidden||refreshTimer!==null)return;refreshTimer=setTimeout(()=>{refreshTimer=null;if(!document.hidden)void refresh()},delay)}
const themeKey="pi-agent-mesh-dashboard-theme",fontKey="pi-agent-mesh-dashboard-font-scale",autoKey="pi-agent-mesh-dashboard-auto-scroll",channelKey="pi-agent-mesh-dashboard-channel";
function make(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
let noticeTimer;
function dashboardNotice(text){let node=$('dashboard-notice');if(!node){node=make('output','dashboard-notice');node.id='dashboard-notice';node.setAttribute('role','status');document.body.append(node)}node.textContent=text;node.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.hidden=true},6500)}
function colorIndex(value){let hash=0;for(const character of String(value||"agent"))hash=(hash*31+character.charCodeAt(0))|0;return Math.abs(hash)%8}
function colorClass(value){return `color-${colorIndex(value)}`}
function shortHash(value){const hash=String(value||"");return hash.length>12?`${hash.slice(0,5)}..${hash.slice(-5)}`:hash}
let contextMenuOpener;
function hideContextMenu(restore=false){const wasOpen=!el.contextMenu.hidden,opener=contextMenuOpener;contextMenuOpener=undefined;el.contextMenu.hidden=true;el.contextMenu.replaceChildren();if(restore===true&&wasOpen&&opener?.isConnected)opener.focus({preventScroll:true})}
function showContextMenu(event,items){contextMenuOpener=event.target?.closest?.('.topology-node,.thread-row,.person-select')||document.activeElement;event.preventDefault();event.stopPropagation();el.contextMenu.replaceChildren(...items.map(item=>{const button=make("button",item.danger?"danger":"",item.label);button.type="button";button.role="menuitem";button.addEventListener("pointerdown",pointerEvent=>pointerEvent.stopPropagation());button.addEventListener("click",async clickEvent=>{clickEvent.preventDefault();clickEvent.stopPropagation();button.disabled=true;try{await item.action()}finally{hideContextMenu()}});return button}));el.contextMenu.hidden=false;const width=el.contextMenu.offsetWidth,height=el.contextMenu.offsetHeight,left=Math.min(event.clientX,window.innerWidth-width-8),top=Math.min(event.clientY,window.innerHeight-height-8);el.contextMenu.style.left=`${Math.max(8,left)}px`;el.contextMenu.style.top=`${Math.max(8,top)}px`;el.contextMenu.querySelector("button")?.focus()}
function option(select,value,label){const item=document.createElement("option");item.value=value;item.textContent=label;select.append(item);return item}
function applyTheme(theme){document.documentElement.dataset.theme=theme;el.theme.textContent=theme==="dark"?"☀":"☾";el.theme.title=theme==="dark"?"Switch to light theme":"Switch to dark theme";el.theme.setAttribute('aria-label',el.theme.title);document.querySelector('meta[name="theme-color"]').content=theme==="dark"?"#101012":"#f5f6f4";localStorage.setItem(themeKey,theme)}
let fontScale=Math.min(1.3,Math.max(.8,Number(localStorage.getItem(fontKey))||1));
function setFontScale(value){fontScale=Math.min(1.3,Math.max(.8,Math.round(value*10)/10));el.timeline.style.setProperty("--font-scale",String(fontScale));el.fontLevel.value=`${Math.round(fontScale*100)}%`;localStorage.setItem(fontKey,String(fontScale))}
function scrollLatest(smooth=true){el.timeline.scrollTo({top:el.timeline.scrollHeight,behavior:smooth?"smooth":"auto"})}
function destinationLabel(message){return message.destination.type==='channel'?`#${channels.find(c=>sameChannel(c.name,message.destination.name))?.name||message.destination.name}`:message.destination.name}
const channelKeyOf=value=>{const valueKey=String(value||'');if(normalizedChannels.has(valueKey))return normalizedChannels.get(valueKey);const raw=valueKey.trim().toLocaleLowerCase('en-US'),key=channelAliases.get(raw)||raw;normalizedChannels.set(valueKey,key);return key};
const sameChannel=(left,right)=>Boolean(left&&right&&channelKeyOf(left)===channelKeyOf(right));
// Use immutable send-time scope, never an agent's present-day active channel.
function messageChannel(message){const scope=message.scopeChannel||(message.destination.type==="channel"?message.destination.name:null);return scope?(channelByKey.get(channelKeyOf(scope))?.name||scope):null}
function messageMatchesChannel(message,name){return sameChannel(messageChannel(message),name)}
function updateRecipientOptions(){const current=el.to.value;el.to.replaceChildren();option(el.to,"*","All agents · user broadcast");option(el.to,"@selected","Selected agents…");const recipients=$("selected-recipients"),chosen=new Set([...recipients.selectedOptions].map(o=>o.value));recipients.replaceChildren();for(const agent of agents){const opt=option(recipients,agent.id,agent.name);opt.selected=chosen.has(agent.id)}const channelGroup=document.createElement("optgroup");channelGroup.label="Channels";for(const channel of channels)option(channelGroup,`#${channel.name}`,`#${channel.name}`);el.to.append(channelGroup);const agentGroup=document.createElement("optgroup");agentGroup.label="Agents";for(const agent of [...agents].sort((a,b)=>a.name.localeCompare(b.name)))option(agentGroup,agent.id,agent.name);el.to.append(agentGroup);el.to.value=[...el.to.querySelectorAll("option")].some(item=>item.value===current)?current:"*"}
function updateMembershipOptions(){const current=el.memberAgent.value;el.memberAgent.replaceChildren();for(const agent of [...agents].sort((a,b)=>a.name.localeCompare(b.name)))option(el.memberAgent,agent.id,agent.name);el.memberAgent.value=agents.some(agent=>agent.id===current)?current:selectedParticipant||agents[0]?.id||"";el.channelOptions.replaceChildren(...channels.filter(channel=>!channel.userOnly).map(channel=>{const item=document.createElement("option");item.value=channel.name;return item}))}
function projects(){const values=new Map();for(const agent of agents)if(agent.projectHash&&!values.has(agent.projectHash))values.set(agent.projectHash,agent.projectName||"Unnamed project");for(const hash of policy.blockedProjects||[]){const name=policy.blockedProjectNames?.[hash]||values.get(hash);values.set(hash,name?`Blocked ${name}`:`Blocked ${shortHash(hash)}`)}return [...values].map(([hash,name])=>({hash,name})).sort((a,b)=>a.name.localeCompare(b.name)||a.hash.localeCompare(b.hash))}
function renderPolicyControls(){el.meshEnabled.checked=policy.enabled!==false;const current=el.policyProject.value,items=projects();el.policyProject.replaceChildren();for(const project of items)option(el.policyProject,project.hash,project.name);el.policyProject.value=items.some(project=>project.hash===current)?current:items[0]?.hash||"";const hash=el.policyProject.value,blocked=(policy.blockedProjects||[]).includes(hash);el.projectHash.textContent=shortHash(hash)||"No project hash available";el.toggleProject.textContent=blocked?"Unblock project":"Block project";el.toggleProject.classList.toggle("danger",!blocked);el.toggleProject.disabled=!hash}
function renderWorkerStatus(){const children=agents.filter(a=>a.parentAgentId||a.id.startsWith('job-')),active=children.filter(a=>a.status!=='offline'),working=active.filter(a=>a.status==='working');$('worker-status').textContent=active.length?`${active.length} live child agent${active.length===1?'':'s'} / ${working.length} working`:'No live child agents / launch a reviewed team in Pi';$('worker-status').title='Workers start only after explicit execution approval in /mesh team or /mesh jobs. Open Work fleet for run, queue and acceptance evidence.';}
$('worker-fleet').addEventListener('click',()=>activateView('fleet'));
function renderAgents(){el.agentCount.textContent=String(agents.length);el.agents.replaceChildren();const visible=agents.filter(agent=>participantStatus==="all"||agent.status===participantStatus);if(!visible.length){el.agents.append(make("p","empty",agents.length?"No participants match this status.":"No Pi agents registered. Reload open Pi sessions."));return}for(const agent of visible){const row=make("div",`person ${colorClass(agent.id||agent.name)} ${agent.status}${agent.enabled===false?" disabled":""}${selectedParticipant===agent.id?" active":""}`),button=make("button","person-select");button.type="button";row.dataset.agent=agent.id;button.setAttribute("aria-pressed",String(selectedParticipant===agent.id));button.setAttribute("aria-label",`${agent.name}, ${agent.status}, ${agent.enabled===false?"disabled":"enabled"}, ${agent.cwd}`);const swatch=make("i","swatch"),copy=make("span","person-copy"),project=agent.projectHash?`${agent.projectName||"Project"} · ${shortHash(agent.projectHash)}`:"No project hash";copy.append(make("b","",agent.name),make("small","",`${agent.status}${agent.model?` · ${agent.model}`:""} · active: ${agent.activeChannel?`#${agent.activeChannel}`:"none"} · joined: ${agent.channels.map(name=>`#${name}`).join(" ")||"no channels"}`),make("code","project-identity",project),make("code","agent-role",agent.parentAgentId?`${agent.role||'worker'} / child of ${agents.find(a=>a.id===agent.parentAgentId)?.name||agent.parentAgentId}`:`role: ${agent.role||'not recorded'}`),make("code","",agent.cwd));button.append(swatch,copy,make("i","state-dot"));const control=make("label","participant-toggle"),controlText=make("span","sr-only",`Enable ${agent.name}`),toggle=make("span","switch"),input=document.createElement("input"),slider=make("span","slider");input.type="checkbox";input.checked=agent.enabled!==false;input.addEventListener("change",event=>{event.stopPropagation();void toggleAgentEnabled(agent,input)});toggle.append(input,slider);control.append(controlText,toggle);button.addEventListener("click",()=>{selectAgentNode(agent.id)});row.addEventListener("contextmenu",event=>showContextMenu(event,[{label:`Configure ${agent.name}…`,action:()=>openAgentConfig(agent.id)},{label:`Kick / disconnect ${agent.name}`,danger:true,action:()=>removeAgentFromMesh(agent.id)}]));row.append(button,control);el.agents.append(row)}}
function channelMessageCount(name){const signature=`${messageRevision}:${channelIndexRevision}`;if(signature!==countSignature){countSignature=signature;channelCounts.clear();for(const message of messages){const scope=messageChannel(message);if(scope){const key=channelKeyOf(scope);channelCounts.set(key,(channelCounts.get(key)||0)+1)}}}return channelCounts.get(channelKeyOf(name))||0}
function renderChannels(){el.threadCount.textContent=String(channels.length);el.threads.replaceChildren();const all=make("button",`thread-row${selectedChannel?"":" active"}`);all.type="button";const allCopy=make("span","thread-copy");allCopy.append(make("b","","All messages"),make("small","",`${messages.length} loaded messages · ${messages.filter(message=>!messageChannel(message)).length} without recorded channel`));all.append(allCopy);all.addEventListener("click",()=>selectChannel(""));el.threads.append(all);const selectedAgent=agents.find(agent=>agent.id===(selectedParticipant||el.memberAgent.value));for(const channel of channels){const joined=Boolean(selectedAgent?.channels.includes(channel.name)),button=make("button",`thread-row${selectedChannel===channel.name?" active":""}${joined?" joined":""}`);button.type="button";const copy=make("span","thread-copy");copy.append(make("b","",`#${channel.name}`),make("small","",`${channel.memberCount} member${channel.memberCount===1?"":"s"}${channel.memberNames.length?` · ${channel.memberNames.join(", ")}`:""}`));button.append(copy,make("span","thread-count",String(channelMessageCount(channel.name))));button.addEventListener("click",()=>selectChannel(channel.name));button.addEventListener("contextmenu",event=>showContextMenu(event,[{label:'Show system',action:()=>showSystem(channel.name)},channel.userOnly?{label:"#user is the protected user inbox",action:async()=>{el.membershipStatus.textContent="#user cannot be closed."}}:{label:`Close #${channel.name}…`,danger:true,action:()=>closeChannel(channel.name)}]));const row=make('div','channel-row');row.append(button);if(!channel.userOnly){const close=make('button','close-channel','×');close.type='button';close.title=`Close #${channel.name} channel (keep history and project files)`;close.setAttribute('aria-label',close.title);close.addEventListener('click',()=>void closeChannel(channel.name));row.append(close)}el.threads.append(row)}el.loadOlder.hidden=!messages.length||messages.length>=total}
function selectChannel(name){selectedChannel=name;selectedParticipant="";activeView=name?`channel:${name}`:"all";if(name)openChannels.add(name);localStorage.setItem(channelKey,name);el.to.value=name?`#${name}`:"*";renderAgents();renderChannels();renderMessages()}
function visibleMessages(){return messages.filter(message=>(!selectedChannel||messageMatchesChannel(message,selectedChannel))&&(!selectedParticipant||message.fromAgentId===selectedParticipant||message.scopeAgentId===selectedParticipant||message.recipientAgentIds?.includes(selectedParticipant)||(message.destination.type==="agent"&&message.destination.id===selectedParticipant)))}
function messageColorKey(message){return message.fromAgentId||message.fromName||"agent"}
function focusSelectedMessage(){const node=el.messages.querySelector(`[data-message-id="${selectedMessageId}"]`);if(!node)return;node.scrollIntoView({block:"center",behavior:"smooth"});node.focus({preventScroll:true})}
function selectMessage(messageId){selectedMessageId=messageId;renderMessages();requestAnimationFrame(focusSelectedMessage)}
function navigationMessages(){const base=visibleMessages();if(selectedParticipant)return base.filter(message=>message.fromType!=="user"&&message.fromAgentId===selectedParticipant);const current=messages.find(message=>message.id===selectedMessageId);if(!current)return[];return base.filter(message=>message.destination.type===current.destination.type&&message.destination.id===current.destination.id)}
function navigateMessage(direction){const candidates=navigationMessages();if(!candidates.length)return;const currentIndex=candidates.findIndex(message=>message.id===selectedMessageId),next=currentIndex<0?(direction>0?candidates[0]:candidates.at(-1)):candidates[currentIndex+direction];if(!next)return;selectedMessageId=next.id;renderMessages();requestAnimationFrame(focusSelectedMessage)}
function createMessageRow(message){
 const mine=message.fromType==='user',article=make('article',`message ${mine?'mine':colorClass(messageColorKey(message))}`);
 article.dataset.agent=mine?'mine':String(message.fromAgentId||'');article.dataset.messageId=String(message.id);article.tabIndex=0;article.setAttribute('aria-current','false');
 article.setAttribute('aria-label',`Message ${message.id} from ${mine?'you':message.fromName}. Use Left and Right Arrow to navigate.`);
 article.addEventListener('click',()=>selectMessage(message.id));article.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectMessage(message.id)}});
 const head=make('header','message-head');if(mine)head.append(make('span','mine-badge','My message'));
 head.append(make('b','',mine?'You (me)':message.fromName),make('span','route-arrow','>>'),make('strong','',destinationLabel(message)));
 const time=make('time','',new Date(message.timestamp).toLocaleString());time.dateTime=message.timestamp;head.append(time);
 const body=make('p','message-body',message.content),tags=make('footer','message-tags');tags.append(make('em','',message.kind||'message'));
 const scope=messageChannel(message);if(scope){const button=make('button','message-channel',`#${scope}`);button.type='button';button.disabled=!channelByKey.has(channelKeyOf(scope));button.title=button.disabled?'Recorded channel is archived or unavailable':'Show messages recorded in this channel';button.addEventListener('click',event=>{event.stopPropagation();selectChannel(scope)});tags.append(button)}else tags.append(make('span','unassigned-channel',message.fromAgentId||message.scopeAgentId?'Channel not recorded':'Administrator · no channel'));
 tags.append(make('span','',destinationLabel(message)),make('span','',`#${message.id}`));article.append(head,body,tags);return article;
}
function updateMessageSelection(){const previous=messageRows.get(renderedSelectedMessageId)?.node,current=messageRows.get(selectedMessageId)?.node;if(previous&&previous!==current){previous.classList.remove('selected');previous.setAttribute('aria-current','false')}if(current){current.classList.add('selected');current.setAttribute('aria-current','true')}renderedSelectedMessageId=selectedMessageId}
function renderMessages(){
 renderWorkbench();if(el.timeline.hidden)return;
 const signature=JSON.stringify([messageRevision,channelIndexRevision,selectedChannel,selectedParticipant]);
 if(signature===renderedMessagesSignature){updateMessageSelection();el.topThread.textContent=selectedChannel?`#${selectedChannel}`:'All messages';el.topMessageCount.textContent=`· ${renderedVisibleMessagesCount} message${renderedVisibleMessagesCount===1?'':'s'}`;return}renderedMessagesSignature=signature;
 const visible=visibleMessages();let cursor=el.messages.firstElementChild;
 // Keyed reconciliation: append a new row without detaching unchanged history or its focused element.
 for(const message of visible){const key=`${messageSignatures.get(message.id)}:${channelIndexRevision}`;let row=messageRows.get(message.id);if(row?.key!==key){row={key,node:createMessageRow(message)};messageRows.set(message.id,row)}if(row.node===cursor)cursor=cursor.nextElementSibling;else if(cursor?.dataset.messageId===String(message.id)){const old=cursor;cursor=cursor.nextElementSibling;old.replaceWith(row.node)}else el.messages.insertBefore(row.node,cursor)}
 while(cursor){const next=cursor.nextElementSibling;cursor.remove();cursor=next}
 if(!visible.length)el.messages.replaceChildren(make('p','empty',messages.length?'No messages match this selection.':'No mesh messages yet.'));
 updateMessageSelection();renderedVisibleMessagesCount=visible.length;const latest=visible.at(-1);el.topThread.textContent=selectedChannel?`#${selectedChannel}`:'All messages';el.topMessageCount.textContent=`· ${visible.length} message${visible.length===1?'':'s'}`;
 el.latestLabel.textContent=latest?`Latest message · ${new Date(latest.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'No messages yet';
 const latestId=latest?.id||0,changed=latestId!==lastVisibleMessageId;lastVisibleMessageId=latestId;if(el.auto.checked&&changed)requestAnimationFrame(()=>scrollLatest(false));
}
function merge(items){let changed=false;for(const item of items){const signature=JSON.stringify(item);if(messageSignatures.get(item.id)===signature)continue;messageSignatures.set(item.id,signature);messageRecords.set(item.id,item);changed=true}if(changed){messages=[...messageRecords.values()].sort((a,b)=>a.id-b.id);messageRevision++}return changed}
async function request(path,init={}){const response=await fetch(path,{cache:"no-store",...init});const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value.error?.message||`Request failed (${response.status})`);return value}
async function updatePolicy(path,payload,pending,success){el.meshStatus.textContent=pending;try{const result=await request(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});el.meshStatus.textContent=typeof success==="function"?success(result):success;dashboardNotice(el.meshStatus.textContent);await refresh();return result}catch(error){el.meshStatus.textContent=error.message;dashboardNotice(error.message);await refresh();return null}}
async function toggleAgentEnabled(agent,input){input.disabled=true;try{const result=await updatePolicy("/api/agents/toggle",{agentId:agent.id,enabled:input.checked},`${input.checked?"Enabling":"Disabling"} ${agent.name}…`,`${agent.name} ${input.checked?"enabled":"disabled"}.`);if(!result)input.checked=agents.find(item=>item.id===agent.id)?.enabled!==false}finally{input.disabled=false}}
async function setGlobalMesh(){el.meshEnabled.disabled=true;try{const result=await updatePolicy("/api/policy/global",{enabled:el.meshEnabled.checked},`${el.meshEnabled.checked?"Enabling":"Disabling"} mesh…`,`Mesh ${el.meshEnabled.checked?"enabled":"disabled"}.`);if(!result)el.meshEnabled.checked=policy.enabled!==false}finally{el.meshEnabled.disabled=false}}
async function kickAllAgents(){const status=el.kickAllStatus.value;el.kickAll.disabled=true;await updatePolicy("/api/agents/kick-all",{status},"Kicking matching participants…",result=>`${result.count} ${status==="all"?"participant(s)":""+status+" participant(s)"} kicked.`);el.kickAll.disabled=false}
async function toggleSelectedProject(){const projectHash=el.policyProject.value;if(!projectHash)return;const blocked=!(policy.blockedProjects||[]).includes(projectHash);el.toggleProject.disabled=true;await updatePolicy("/api/projects/toggle",{projectHash,blocked},`${blocked?"Blocking":"Unblocking"} project…`,`Project ${blocked?"blocked":"unblocked"}.`);el.toggleProject.disabled=false}
async function refresh(){
 if(polling){refreshAgain=true;return}polling=true;
 try{
  const state=await request('/api/state'),selectionBefore=JSON.stringify([selectedParticipant,selectedChannel,activeView]),previousTotal=total;
  agents=state.agents.sort((a,b)=>a.name.localeCompare(b.name));policy=state.policy||{enabled:true,blockedProjects:[],blockedProjectNames:{}};
  if(selectedParticipant&&!agents.some(agent=>agent.id===selectedParticipant))selectedParticipant='';
  channels=(state.channels||[]).sort((a,b)=>a.name.localeCompare(b.name));updateChannelIndex();stateLoaded=true;
  total=state.totalMessages;const messagesChanged=merge(state.messages);
  const migrated=channels.find(c=>sameChannel(c.name,selectedChannel));if(migrated&&migrated.name!==selectedChannel){openChannels.delete(selectedChannel);selectedChannel=migrated.name;openChannels.add(selectedChannel);if(activeView.startsWith('channel:'))activeView='channel:'+selectedChannel;localStorage.setItem(channelKey,selectedChannel)}
  if(selectedChannel&&!channels.some(channel=>channel.name===selectedChannel)){selectedChannel='';localStorage.removeItem(channelKey)}
  const nextAgents=JSON.stringify(agents.map(({lastSeenAt,lastAck,registeredAt,...ui})=>ui)),nextChannels=JSON.stringify(channels),nextPolicy=JSON.stringify(policy);
  const agentsChanged=nextAgents!==agentUISignature,channelsChanged=nextChannels!==channelsUISignature,policyChanged=nextPolicy!==policyUISignature,selectionChanged=selectionBefore!==JSON.stringify([selectedParticipant,selectedChannel,activeView]);
  agentUISignature=nextAgents;channelsUISignature=nextChannels;policyUISignature=nextPolicy;
  if(agentsChanged||channelsChanged){updateRecipientOptions();updateMembershipOptions();projectState()}
  if(agentsChanged||policyChanged)renderPolicyControls();
  if(agentsChanged||selectionChanged)renderAgents();
  if(agentsChanged)renderWorkerStatus();
  if(agentsChanged||channelsChanged||messagesChanged||selectionChanged||total!==previousTotal)renderChannels();
  if(agentsChanged||channelsChanged||messagesChanged||policyChanged||selectionChanged)renderMessages();
  el.connection.className='connection online';el.connection.textContent='Connected';
 }catch{el.connection.className='connection offline';el.connection.textContent='Disconnected'}finally{polling=false;if(refreshAgain){refreshAgain=false;scheduleRefresh()}}
}
async function sendIntervention(){el.status.textContent="Sending…";const sendButton=el.form.querySelector(".send");sendButton.disabled=true;try{const payload={to:el.to.value,kind:el.kind.value,content:el.content.value.trim()};if(el.to.value==="@selected"){payload.to="#user";payload.recipientAgentIds=[...$("selected-recipients").selectedOptions].map(o=>o.value);if(!payload.recipientAgentIds.length)throw new Error("Select at least one agent")} if(!payload.content)throw new Error("A message is required");const result=await request("/api/user/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});merge([result.message]);total++;selectChannel(result.message.destination.type==="channel"?result.message.destination.name:"");el.content.value="";el.status.textContent=`Sent #${result.message.id} to ${destinationLabel(result.message)}.`;await refresh()}catch(error){el.status.textContent=error.message}finally{sendButton.disabled=false}}
async function changeMembership(action){const agentId=el.memberAgent.value,channel=el.memberChannel.value.trim().replace(/^#/,"");if(!agentId||!channel){el.membershipStatus.textContent="Choose an agent and channel.";return}el.membershipStatus.textContent=`${action==="join"?"Joining":"Removing"}…`;try{const result=await request(`/api/channels/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agentId,channels:[channel]})});el.membershipStatus.textContent=`${action==="join"?"Joined":"Kicked from"} ${result.changed.length?result.changed.map(name=>`#${name}`).join(", "):"with no changes"}.`;await refresh()}catch(error){el.membershipStatus.textContent=error.message}}
async function removeAgentFromMesh(requestedAgentId){const agentId=requestedAgentId||el.memberAgent.value,agent=agents.find(item=>item.id===agentId);if(!agent)return;el.membershipStatus.textContent="Removing agent…";try{await request("/api/agents/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agentId})});if(selectedParticipant===agentId)selectedParticipant="";el.membershipStatus.textContent=`Removed ${agent.name}. The agent must run /mesh join.`;dashboardNotice(el.membershipStatus.textContent);await refresh()}catch(error){el.membershipStatus.textContent=error.message;dashboardNotice(error.message)}}
async function closeChannel(name){if(name==="user"){el.membershipStatus.textContent="#user cannot be closed.";return}el.membershipStatus.textContent=`Closing #${name}…`;try{await request("/api/channels/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channel:name})});if(selectedChannel===name)selectedChannel="";el.membershipStatus.textContent=`Closed #${name}. History and project files are preserved.`;dashboardNotice(el.membershipStatus.textContent);await refresh()}catch(error){el.membershipStatus.textContent=error.message;dashboardNotice(error.message)}}
applyTheme(localStorage.getItem(themeKey)||"dark");setFontScale(fontScale);selectedChannel=localStorage.getItem(channelKey)||"";const savedAuto=localStorage.getItem(autoKey);el.auto.checked=savedAuto===null?true:savedAuto==="true";
el.theme.addEventListener("click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));el.fontDown.addEventListener("click",()=>setFontScale(fontScale-.1));el.fontUp.addEventListener("click",()=>setFontScale(fontScale+.1));el.auto.addEventListener("change",()=>{localStorage.setItem(autoKey,String(el.auto.checked));if(el.auto.checked)scrollLatest()});el.jump.addEventListener("click",()=>scrollLatest());el.meshEnabled.addEventListener("change",()=>void setGlobalMesh());el.policyProject.addEventListener("change",renderPolicyControls);el.toggleProject.addEventListener("click",()=>void toggleSelectedProject());el.kickAll.addEventListener("click",()=>void kickAllAgents());
for(const filter of document.querySelectorAll("[data-participant-filter]"))filter.addEventListener("click",()=>{participantStatus=filter.dataset.participantFilter;for(const item of document.querySelectorAll("[data-participant-filter]")){const active=item===filter;item.classList.toggle("active",active);item.setAttribute("aria-pressed",String(active))}const selected=agents.find(agent=>agent.id===selectedParticipant);if(selected&&participantStatus!=="all"&&selected.status!==participantStatus)selectedParticipant="";renderAgents();renderChannels();renderMessages()});
el.to.addEventListener("change",()=>{$("selected-recipients-label").hidden=el.to.value!=="@selected"});
el.form.addEventListener("submit",event=>{event.preventDefault();void sendIntervention()});el.content.addEventListener("keydown",event=>{if(event.key!=="Enter"||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;event.preventDefault();if(el.content.value.trim())el.form.requestSubmit();else el.status.textContent="A message is required."});el.joinChannel.addEventListener("click",()=>void changeMembership("join"));el.leaveChannel.addEventListener("click",()=>void changeMembership("kick"));el.removeAgent.addEventListener("click",()=>void removeAgentFromMesh());el.memberAgent.addEventListener("change",()=>{selectAgentNode(el.memberAgent.value,false)});
document.addEventListener("click",event=>{if(!el.contextMenu.contains(event.target))hideContextMenu()});document.addEventListener("contextmenu",event=>{if(!event.target.closest?.(".person,.thread-row,.topology-node,.sigma-mount"))hideContextMenu()});document.addEventListener("keydown",event=>{if(event.key==="Escape")hideContextMenu(true)});window.addEventListener("resize",hideContextMenu);el.agents.addEventListener("scroll",hideContextMenu);el.threads.addEventListener("scroll",hideContextMenu);
document.addEventListener("keydown",event=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight"||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;const target=event.target,interactive=target instanceof HTMLElement?target.closest("input,textarea,select,button,a,[contenteditable=true]"):null;if(interactive&&!interactive.matches(".person"))return;if(!selectedParticipant&&!selectedMessageId)return;event.preventDefault();navigateMessage(event.key==="ArrowRight"?1:-1)});
el.loadOlder.addEventListener("click",async()=>{const oldest=messages[0]?.id;if(!oldest)return;try{const result=await request(`/api/messages?before=${oldest}&limit=250`);merge(result.messages);renderChannels();renderMessages()}catch(error){el.status.textContent=error.message}});
// Workbench state stays independent from polling: selection and open tabs survive refreshes.
const openChannels=new Set(selectedChannel?[selectedChannel]:[]);
let activeView=selectedChannel?`channel:${selectedChannel}`:'kanban',configAgentId='',configCatalog=[],configCatalogGeneration=null,configLoadTicket=0;
let topologySignature="",matrixSignature="",workbenchSignature='',fleetViewActive=false,usageViewActive=false;
let topologyFit=true;
let topologyQuery='',selectedProject='',topologyProject='';
function projectState(){window.dispatchEvent(new CustomEvent('mesh-project-state',{detail:{projects:projects(),selectedProject}}))}
function showProject(hash,drilldown=true){if(hash&&!projects().some(p=>p.hash===hash)){topologyFit=false;topologyView?.focusProject(hash);return}if(hash&&drilldown)topologyView?.expandBranch(`project:${hash}`,false);selectedProject=hash;if(!drilldown){projectState();return}topologyProject=hash;topologyFit=true;topologySignature='';updateTopologyModeUI();activateView('kanban');projectState();renderTopology()}
window.addEventListener('mesh-project-select',event=>showProject(event.detail||''));
let layoutCache={signature:'',positions:new Map()},topologyView;
function topologyScope(){if(!topologyProject)return {channels,agents};const members=agents.filter(a=>projectIdentity(a)===topologyProject),names=new Set(members.flatMap(a=>a.channels||[]).map(n=>channelKeyOf(n)));return{agents:members,channels:channels.filter(c=>!c.userOnly&&(c.projectHash===topologyProject||names.has(channelKeyOf(c.name)))).map(c=>({...c,projectHash:topologyProject}))}}
function showSystem(name){const channel=channels.find(c=>sameChannel(c.name,name));const project=channel?.projectHash||agents.find(a=>a.channels.some(c=>sameChannel(c,name)))?.projectHash;if(project)showProject(project)}
function topologyLayout(){
 const {channels,agents}=topologyScope();
 const ids=[...channels.map(c=>'channel:'+c.name),...agents.map(a=>'agent:'+a.id)],edges=[];
 for(const a of agents)for(const name of a.channels){const c=channels.find(c=>sameChannel(c.name,name));if(c)edges.push(['channel:'+c.name,'agent:'+a.id])}
 const signature=JSON.stringify([ids,edges,channels.map(c=>[c.projectHash,c.projectName,c.aliases,c.userOnly]),agents.map(a=>[a.role,a.parentAgentId,a.projectHash,a.cwd,a.projectName,a.activeChannel]),topologyProject]);if(layoutCache.signature===signature)return layoutCache;
 return layoutCache={signature,...circularProjectLayout(agents,channels)};
}
function agentStatus(agent){if(agent.status==="offline")return "Offline";if(agent.effectiveEnabled===false)return "Disabled";return ({thinking:"Thinking",working:"Working",waiting:"Waiting on agent response",idle:"Idle"})[agent.activity||agent.status]||agent.status}
function applyTopologyZoom(){if(!topologyView)return;topologyView.resize();if(topologyFit)topologyView.fit();$('topology-fit').setAttribute('aria-pressed',String(topologyFit));$('topology-fit').title='Fit all projects, channels and agents'}
function zoomTopology(factor,clientX,clientY){const r=$('topology-canvas').getBoundingClientRect();topologyFit=false;topologyView?.zoom(factor,clientX===undefined?undefined:clientX-r.left,clientY===undefined?undefined:clientY-r.top);$('topology-fit').setAttribute('aria-pressed','false')}
function selectAgentNode(id,toggle=true){
 selectedParticipant=toggle&&selectedParticipant===id?"":id;
 selectedChannel="";activeView="all";localStorage.removeItem(channelKey);
 if(selectedParticipant){el.to.value=id;el.memberAgent.value=id}else el.to.value="*";
 renderAgents();renderChannels();renderMessages();
}
function renderAgentConfig(){
 const agent=agents.find(a=>a.id===configAgentId),form=$('agent-config-form');
 $('agent-config-target').replaceChildren(...agents.map(item=>new Option(`${item.name} · ${item.model||'no model'} · ${item.status}`,item.id)));$('agent-config-target').value=configAgentId;
 const unavailable=!agent?.configurable||configCatalogGeneration!==agent.generation;
 $('agent-config-provider').disabled=unavailable;$('agent-config-model').disabled=unavailable;$('agent-config-thinking').disabled=unavailable;
 $('agent-config-title').textContent=agent?`Configure ${agent.name}`:'Agent unavailable';
 $('agent-config-info').textContent=agent?`${agent.projectName||'Project'} · ${agent.cwd} · current: ${agent.model||'no model'} · thinking: ${agent.thinkingLevel||'unknown'}`:'This agent is no longer registered.';
 form.querySelector('button[type=submit]').disabled=unavailable||agent?.configuration?.state==='pending';
 const receipt=agent?.configuration;
 if(receipt)$('agent-config-status').textContent=receipt.state==='pending'?'Waiting for the selected Pi session to become idle and apply this request…':receipt.state==='applied'?`Applied by Pi: ${receipt.actualModel||agent.model} · thinking ${receipt.actualThinkingLevel||agent.thinkingLevel}`:receipt.state==='expired'?'Request expired; choose and submit a new configuration.':`Rejected by Pi: ${receipt.reason||'Unknown reason'}`;
 else $('agent-config-status').textContent=agent&&!agent.configurable?'This agent is offline, an immutable worker, or needs /reload to enable configuration.':'';
 if(agent&&configCatalogGeneration!==null&&configCatalogGeneration!==agent.generation)$('agent-config-error').textContent='Target restarted. Reload its catalog before changing settings.';
}
function updateConfigThinking(){const model=$('agent-config-model').value.trim(),available=configCatalog.find(item=>item.id===model)?.levels||[],current=$('agent-config-thinking').value,select=$('agent-config-thinking');select.replaceChildren();option(select,'','Keep current thinking level');for(const level of available)option(select,level,level);select.value=available.includes(current)?current:'';const valid=configCatalog.some(item=>item.id===model);$('agent-config-model').setCustomValidity(valid?'':'Choose an exact model advertised by this target.');$('agent-config-error').textContent=valid?'':'Choose an exact target-advertised model; typing a name does not establish availability.';if(valid)$('agent-config-provider').value=model.split('/')[0];}
function filterConfigModels(){const provider=$('agent-config-provider').value;$('agent-config-models').replaceChildren(...configCatalog.filter(item=>!provider||item.id.split('/')[0]===provider).map(item=>new Option(item.id,item.id)));}
async function openAgentConfig(agentId){
 const agent=agents.find(a=>a.id===agentId);if(!agent)return;const ticket=++configLoadTicket;configAgentId=agentId;configCatalog=[];configCatalogGeneration=null;$('agent-config-reviewed').checked=false;$('agent-config-provider').replaceChildren();$('agent-config-models').replaceChildren();$('agent-config-model').value=agent.model||'';updateConfigThinking();activateView('config');
 try{const result=await request(`/api/agents/config?agentId=${encodeURIComponent(agentId)}&catalog=1`);if(configAgentId!==agentId||ticket!==configLoadTicket)return;if(result.agent?.generation!==agents.find(item=>item.id===agentId)?.generation)throw Error('Target changed while loading. Reload the catalog.');configCatalog=result.models||[];configCatalogGeneration=result.agent.generation;$('agent-config-provider').replaceChildren(...[...new Set(configCatalog.map(item=>item.id.split('/')[0]))].sort().map(value=>new Option(value,value)));$('agent-config-provider').value=agent.model?.split('/')[0]||'';filterConfigModels();updateConfigThinking();renderAgentConfig();$('agent-config-model').focus()}
 catch(error){if(ticket===configLoadTicket)$('agent-config-status').textContent=error.message}
}
$('agent-config-model').addEventListener('input',updateConfigThinking);
$('agent-config-form').addEventListener('input',event=>{if(event.target.id!=='agent-config-reviewed')$('agent-config-reviewed').checked=false;});
$('agent-config-provider').onchange=()=>{filterConfigModels();$('agent-config-model').value='';updateConfigThinking();};
$('agent-config-reload').onclick=()=>openAgentConfig(configAgentId);
$('agent-config-target').onchange=()=>openAgentConfig($('agent-config-target').value);
$('agent-settings-open').onclick=()=>{const id=selectedParticipant||agents.find(item=>item.configurable)?.id||agents[0]?.id;if(id)void openAgentConfig(id);else dashboardNotice('No registered agents to configure.');};
$('agent-config-form').addEventListener('submit',async event=>{event.preventDefault();const agent=agents.find(a=>a.id===configAgentId),model=$('agent-config-model').value.trim(),thinkingLevel=$('agent-config-thinking').value,status=$('agent-config-status');if(!agent?.configurable||agent.generation!==configCatalogGeneration)return status.textContent='Agent/catalog is unavailable or stale. Reload it.';const advertised=configCatalog.find(item=>item.id===model);if(!advertised||thinkingLevel&&!advertised.levels.includes(thinkingLevel))return status.textContent='Select an exact advertised model and supported thinking level.';if(model===agent.model&&!thinkingLevel)return status.textContent='Choose a different model or thinking level.';if(!$('agent-config-reviewed').checked)return status.textContent='Review the selected target/model and check the confirmation box.';status.textContent='Sending request…';try{const result=await request('/api/agents/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentId:agent.id,generation:configCatalogGeneration,...(model&&model!==agent.model?{model}:{}),...(thinkingLevel?{thinkingLevel}:{})})});status.textContent=`Request ${result.request.id} queued; waiting for the target Pi session. This is not yet applied.`;await refresh()}catch(error){status.textContent=error.message}});
function activateView(view){
 if(view==='kanban'||view==="matrix"||view==="fleet"||view==='usage'||view==='config'&&configAgentId){activeView=view;renderWorkbench();return}
 selectChannel(view.startsWith("channel:")?view.slice(8):"");
}
function renderWorkbench(){
 for(const name of openChannels)if(!channels.some(c=>c.name===name))openChannels.delete(name);
 if(activeView.startsWith("channel:")&&!openChannels.has(activeView.slice(8))){activeView="all";selectedChannel=""}
 const tabs=$("message-tabs"),focused=document.activeElement?.dataset.view;
 const views=[['kanban','Project Kanban'],["matrix","Membership matrix"],["all","All messages"],["fleet","Work fleet"],["usage","Daily usage"],...(configAgentId?[["config",`Configure ${agents.find(a=>a.id===configAgentId)?.name||'agent'}`]]:[]),...[...openChannels].map(name=>[`channel:${name}`,`#${name}`])];
 const signature=JSON.stringify([views,activeView]);if(signature!==workbenchSignature){workbenchSignature=signature;tabs.replaceChildren();
 for(const [view,label] of views){
  const button=make("button","workspace-tab",label);button.type="button";button.role="tab";button.dataset.view=view;
  button.id=`workspace-tab-${views.findIndex(item=>item[0]===view)}`;
  button.setAttribute("aria-selected",String(activeView===view));button.tabIndex=activeView===view?0:-1;
  button.setAttribute("aria-controls",view==='kanban'?'kanban-panel':view==="matrix"?"matrix-panel":view==="fleet"?"fleet-panel":view==='usage'?'usage-panel':view==='config'?'agent-config-panel':"timeline-main");
  if(view==="matrix")button.title="Pinned membership matrix";
  button.addEventListener("click",()=>activateView(view));
  if(view.startsWith('channel:')||view==='config'){const group=make('span','workspace-tab-group'),close=make('button','close-tab','×');close.type='button';close.title=view==='config'?'Close agent configuration tab':`Close ${label} tab (keep channel)`;close.setAttribute('aria-label',close.title);close.addEventListener('click',()=>{if(view==='config')configAgentId='';else openChannels.delete(view.slice(8));if(activeView===view)activateView('all');else renderWorkbench()});group.append(button,close);tabs.append(group)}else tabs.append(button);
  if(activeView===view)$(view==='kanban'?'kanban-panel':view==="matrix"?"matrix-panel":view==="fleet"?"fleet-panel":view==='usage'?'usage-panel':view==='config'?'agent-config-panel':"timeline-main").setAttribute("aria-labelledby",button.id);
 }
 if(focused)tabs.querySelectorAll("button").forEach(b=>{if(b.dataset.view===focused)b.focus({preventScroll:true})});
 }
 $('kanban-panel').hidden=activeView!=='kanban';if(activeView==='kanban'){projectState();window.dispatchEvent(new CustomEvent('mesh-kanban-view'));el.topThread.textContent='Project Kanban';el.topMessageCount.textContent='· task ownership, decisions and comments'}
 $("matrix-panel").hidden=activeView!=="matrix";el.timeline.hidden=activeView==='kanban'||activeView==="matrix"||activeView==="fleet"||activeView==='usage'||activeView==='config';
 $("fleet-panel").hidden=activeView!=="fleet";$('agent-config-panel').hidden=activeView!=='config';if(activeView==='config')renderAgentConfig();if(fleetViewActive!==(activeView==='fleet')){fleetViewActive=activeView==='fleet';window.dispatchEvent(new CustomEvent('mesh-fleet-view',{detail:fleetViewActive}))}
 $('usage-panel').hidden=activeView!=='usage';if(usageViewActive!==(activeView==='usage')){usageViewActive=activeView==='usage';window.dispatchEvent(new CustomEvent('mesh-usage-view',{detail:usageViewActive}))}
 if(activeView==='usage'){el.topThread.textContent='Daily agent usage';el.topMessageCount.textContent='· dates, tokens, cache and estimated cost'}
 if(activeView==='config'){el.topThread.textContent='Configure agent';el.topMessageCount.textContent='· model and thinking level'}
 if(activeView==='fleet'){el.topThread.textContent='Work fleet';el.topMessageCount.textContent='· durable jobs, receipts and evidence'}
 if(activeView==="matrix"){el.topThread.textContent="Membership matrix";el.topMessageCount.textContent=`· ${agents.length} agents · ${channels.length} channels`}
 const agent=agents.find(a=>a.id===selectedParticipant);
 $("filter-status").textContent=activeView==='usage'?'Daily agent usage':activeView==='config'?'Agent configuration':activeView==="matrix"?"Membership matrix":agent?`Messages to/from ${agent.name}`:selectedChannel?`Channel #${selectedChannel}`:"All messages";
 renderTopology();renderMatrix();
}
function topologyContext(node,event){
 if(!node)return;
 const branch=[{label:node.childCount?'Focus this branch':'Focus this node',action:()=>topologyView.focus(node.id)},...(node.childCount?[{label:node.expanded?`Collapse group (${node.descendantCount} descendants)`:`Expand group (${node.hiddenCount} hidden)`,action:()=>topologyView.setCollapsed(node.id,node.expanded)},{label:'Expand entire branch',action:()=>topologyView.expandBranch(node.id)}]:[])];
 if(node.kind==='project'){showContextMenu(event,[...branch,...(projects().some(p=>p.hash===node.project)?[{label:`Open project Kanban: ${node.label}`,action:()=>{showProject(node.project,false);activateView('kanban')}},{label:`Focus project ${node.label} only`,action:()=>showProject(node.project)}]:[]),{label:'Show full topology',action:()=>showProject('')},{label:'Collapse all groups',action:()=>topologyView.expandAll(false)},{label:'Expand all groups',action:()=>topologyView.expandAll(true)}]);return}
 if(node.kind==='channel'){const c=channels.find(c=>c.name===node.channel);if(!c)return;showContextMenu(event,[...branch,{label:'Show system',action:()=>showSystem(c.name)},{label:'Open channel conversation',action:()=>selectChannel(c.name)},{label:'Inspect membership matrix',action:()=>activateView('matrix')},...(c.userOnly?[]:[{label:`Close #${c.name}…`,danger:true,action:()=>closeChannel(c.name)}])]);return}
 const a=agents.find(a=>a.id===node.agent);if(!a)return;showContextMenu(event,[...branch,{label:'View agent messages',action:()=>selectAgentNode(a.id,false)},{label:`Configure ${a.name}…`,action:()=>openAgentConfig(a.id)},{label:'Send user intervention…',action:()=>{el.to.value=a.id;el.to.dispatchEvent(new Event('change'));openSection('composer');$('controls-tab').click();el.content.focus()}},{label:a.enabled===false?'Enable agent':'Disable agent',action:()=>updatePolicy('/api/agents/toggle',{agentId:a.id,enabled:a.enabled===false},'Updating agent…','Agent updated.')},{label:'Disconnect agent',danger:true,action:()=>removeAgentFromMesh(a.id)}]);
}
function renderTopology(){
 if(!stateLoaded||document.hidden||$('topology-body').hidden||document.querySelector('.workspace').classList.contains('focus-messages'))return;
 if(topologyProject&&!agents.some(a=>projectIdentity(a)===topologyProject)){topologyProject='';updateTopologyModeUI()}
 const scope=topologyScope();
 const signature=JSON.stringify([scope.agents.map(a=>[a.id,a.name,a.model,a.role,a.parentAgentId,a.runId,a.projectHash,a.cwd,a.projectName,a.status,a.activity,a.enabled,a.effectiveEnabled,a.channels,a.activeChannel]),scope.channels.map(c=>[c.name,c.projectHash,c.projectName,c.aliases,c.userOnly,channelMessageCount(c.name)]),selectedParticipant,selectedChannel,activeView,topologyProject,topologyQuery]);if(signature===topologySignature)return;topologySignature=signature;
 if(!topologyView)topologyView=new TopologyRenderer($('topology-canvas'),{context:topologyContext,branch:node=>{if(node?.kind==='project'&&projects().some(p=>p.hash===node.project)){showProject(node.project,false);activateView('kanban')}},cameraChanged:()=>{topologyFit=false;$('topology-fit').setAttribute('aria-pressed','false')},select:node=>{if(node.kind==='project')showProject(node.project,false);else if(node.kind==='agent')selectAgentNode(node.agent);else selectChannel(selectedChannel===node.channel&&activeView!=='matrix'?'':node.channel)}});
 const layout=topologyLayout();topologyView.update(topologyModel(scope.agents,scope.channels,layout,{selectedAgent:activeView==='matrix'?'':selectedParticipant,selectedChannel:activeView==='matrix'?'':selectedChannel,query:topologyQuery,channelCount:channelMessageCount}),{fit:topologyFit});
}
function renderMatrix(){
 if(activeView!=='matrix')return;
 const signature=JSON.stringify([agents.map(a=>[a.id,a.name,a.status,a.activity,a.effectiveEnabled,a.channels,a.activeChannel]),channels.map(c=>c.name)]);if(signature===matrixSignature)return;matrixSignature=signature;
 const panel=$("matrix-panel"),oldScroll=panel.querySelector(".matrix-scroll"),scrollTop=oldScroll?.scrollTop||0,scrollLeft=oldScroll?.scrollLeft||0;panel.replaceChildren(make("h2","","Membership matrix"),make("p","muted","Status is live agent activity. ★ marks the selected channel, not whether an agent is online. Headings filter messages."));
 if(!agents.length){panel.append(make("p","empty","No registered agents."));return}
 const table=make("table","membership-matrix"),head=make("thead"),row=make("tr"),body=make("tbody");
 table.setAttribute("aria-label","Agents and current channel memberships");
 const first=make("th","","Agent"),statusHeading=make("th","","Status"),activeHeading=make("th","","Selected channel");first.scope="col";statusHeading.scope="col";activeHeading.scope="col";row.append(first,statusHeading,activeHeading);
 for(const c of channels){const th=make("th"),button=make("button","",`#${c.name}`);th.scope="col";button.addEventListener("click",()=>selectChannel(c.name));th.append(button);row.append(th)}head.append(row);
 for(const agent of agents){
  const tr=make("tr"),th=make("th"),button=make("button","",agent.name);tr.dataset.agent=agent.id;th.scope="row";button.addEventListener("click",()=>selectAgentNode(agent.id));th.append(button);tr.append(th,make("td",`matrix-status ${agent.status}`,agentStatus(agent)));
  const current=make("td","matrix-current");if(agent.activeChannel){const link=make("button","",`#${agent.activeChannel}`);link.addEventListener("click",()=>selectChannel(agent.activeChannel));current.append(link)}else current.textContent="None";tr.append(current);
  for(const c of channels){
   const joined=c.userOnly||agent.channels.some(name=>sameChannel(name,c.name)),active=joined&&sameChannel(agent.activeChannel,c.name),cell=make("td",active?"joined active-membership":joined?"joined":"not-joined");
   if(joined){const link=make("button","",c.userOnly?"User inbox":active?"★ Selected":"● Joined");link.title=`${agent.name} ${active?"has selected":"is a member of"} #${c.name}. Show this channel's messages.`;link.addEventListener("click",()=>selectChannel(c.name));cell.append(link)}else{cell.textContent="—";cell.setAttribute("aria-label","Not joined")}
   tr.append(cell);
  }
  body.append(tr);
 }
 table.append(head,body);const scroll=make("div","matrix-scroll");scroll.append(table);panel.append(scroll);scroll.scrollTop=scrollTop;scroll.scrollLeft=scrollLeft;
}
function setSection(section,collapsed,persist=true){section.classList.toggle('section-collapsed',collapsed);section.querySelector('.section-toggle').setAttribute('aria-expanded',String(!collapsed));if(persist)localStorage.setItem('mesh-fold-'+section.id,String(collapsed));const explorer=$('explorer-panel');explorer.classList.toggle('channels-folded',$('channel-panel').classList.contains('section-collapsed'));explorer.classList.toggle('participants-folded',$('participant-panel').classList.contains('section-collapsed'))}
function openSection(id){const section=$(id);if(section?.querySelector('.section-toggle'))setSection(section,false)}
function initializeSections(){
 for(const [selector,id,folded] of [['.channel-panel','channel-panel',false],['.participant-panel','participant-panel',false],['.mesh-controls','mesh-controls',true],['#composer','composer',false],['#membership','membership',true]]){
  const section=document.querySelector(selector);section.id=id;const heading=section.querySelector('.section-title,.compose-head'),label=heading.firstElementChild,button=make('button','section-toggle',label.textContent);button.type='button';if(label.id)button.id=label.id;button.setAttribute('aria-controls',id);label.replaceWith(button);
  heading.addEventListener('click',event=>{if(event.target.closest('button,input,select')&&!event.target.closest('.section-toggle'))return;setSection(section,!section.classList.contains('section-collapsed'))});
 }
 for(const [id,folded] of [['channel-panel',false],['participant-panel',false],['mesh-controls',true],['composer',false],['membership',true]]){const saved=localStorage.getItem('mesh-fold-'+id);setSection($(id),saved===null?folded:saved==='true',false)}
}
function initializeWorkbench(){
 initializeSections();
 const explorer=$("explorer-panel");explorer.role="tabpanel";explorer.setAttribute("aria-labelledby","explorer-tab");$('inspector-body').append(explorer);
 for(const button of document.querySelectorAll("[data-inspector]"))button.addEventListener("click",()=>{
  for(const tab of document.querySelectorAll("[data-inspector]")){const active=button===tab;tab.setAttribute("aria-selected",String(active));tab.tabIndex=active?0:-1;$(tab.dataset.inspector).hidden=!active}
 });
 // Standard keyboard tab navigation, scoped so it never navigates timeline messages.
 for(const list of document.querySelectorAll('[role="tablist"]'))list.addEventListener("keydown",event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const tabs=[...list.querySelectorAll('[role="tab"]')],index=tabs.indexOf(document.activeElement);
  const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
  tabs[next].click();list.querySelectorAll('[role="tab"]')[next]?.focus();
 });
 const workspace=document.querySelector(".workspace"),resizer=$("topology-resizer"),toggle=$("topology-toggle");
 const inspectorWidth=()=>workspace.clientWidth>800?document.querySelector(".intervention").getBoundingClientRect().width:0;
 let preferredWidth=Number(localStorage.getItem("mesh-topology-width"))||Math.round((workspace.clientWidth-inspectorWidth())*.45),width=preferredWidth;
 const limit=()=>Math.max(180,Math.min(700,workspace.clientWidth-inspectorWidth()-266));
 function resize(value,persist=false){width=Math.max(180,Math.min(limit(),value));workspace.style.setProperty("--topology-width",`${width}px`);resizer.setAttribute("aria-valuenow",String(Math.round(width)));resizer.setAttribute("aria-valuemax",String(Math.round(limit())));if(persist){preferredWidth=width;localStorage.setItem("mesh-topology-width",String(width))}}
 function collapse(value){workspace.classList.toggle("topology-collapsed",value);$("topology-body").hidden=value;toggle.textContent=value?"›":"‹";toggle.setAttribute("aria-expanded",String(!value));toggle.title=value?"Expand topology":"Collapse topology";resizer.tabIndex=value?-1:0;localStorage.setItem("mesh-topology-collapsed",String(value));if(!value)requestAnimationFrame(()=>{renderTopology();applyTopologyZoom()})}
 toggle.addEventListener("click",()=>collapse(!workspace.classList.contains("topology-collapsed")));
 resizer.addEventListener("pointerdown",event=>{if(event.button!==0||workspace.classList.contains("topology-collapsed"))return;event.preventDefault();resizer.setPointerCapture(event.pointerId);resizer.classList.add("dragging")});
 resizer.addEventListener("pointermove",event=>{if(resizer.hasPointerCapture(event.pointerId))resize(event.clientX-workspace.getBoundingClientRect().left)});
 resizer.addEventListener("pointerup",event=>{if(resizer.hasPointerCapture(event.pointerId)){resizer.releasePointerCapture(event.pointerId);resize(width,true)}resizer.classList.remove("dragging")});
 resizer.addEventListener("lostpointercapture",()=>resizer.classList.remove("dragging"));
 resizer.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();event.stopPropagation();resize(event.key==="Home"?180:event.key==="End"?limit():width+(event.key==="ArrowRight"?20:-20),true)});
 window.addEventListener("resize",()=>resize(preferredWidth));resize(preferredWidth);collapse(localStorage.getItem("mesh-topology-collapsed")==="true");
}
initializeWorkbench();
const workspace=document.querySelector('.workspace');let focusMode='normal';
function setInspectorCollapsed(collapsed,persist=true){workspace.classList.toggle('inspector-collapsed',collapsed);$('inspector-toggle').setAttribute('aria-expanded',String(!collapsed));$('inspector-toggle').textContent=collapsed?'‹':'›';$('inspector-toggle').title=collapsed?'Expand right panel':'Collapse right panel';if(persist)localStorage.setItem('mesh-inspector-collapsed',String(collapsed));requestAnimationFrame(()=>{renderTopology();applyTopologyZoom()})}
function setFocusMode(mode,persist=true){focusMode=mode;workspace.classList.toggle('focus-topology',mode==='topology');workspace.classList.toggle('focus-messages',mode==='messages');if(mode==='topology'&&$('topology-toggle').getAttribute('aria-expanded')==='false')$('topology-toggle').click();if(mode==='normal'){if($('topology-toggle').getAttribute('aria-expanded')==='false')$('topology-toggle').click();setInspectorCollapsed(false,persist)}requestAnimationFrame(()=>{renderTopology();applyTopologyZoom()})}
$('inspector-toggle').addEventListener('click',()=>setInspectorCollapsed(!workspace.classList.contains('inspector-collapsed')));
$('view-topology').addEventListener('click',()=>setFocusMode('topology'));$('view-messages').addEventListener('click',()=>setFocusMode('messages'));$('view-reset').addEventListener('click',()=>setFocusMode('normal'));
setInspectorCollapsed(localStorage.getItem('mesh-inspector-collapsed')!=='false',false);
document.addEventListener('keydown',event=>{if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['t','m','r'].includes(event.key.toLowerCase())||document.querySelector('#mesh-tour')?.open)return;const target=event.target;if(target instanceof HTMLElement&&target.closest('input,textarea,select,[contenteditable=true]'))return;event.preventDefault();setFocusMode(event.key.toLowerCase()==='t'?'topology':event.key.toLowerCase()==='m'?'messages':'normal')});
function updateTopologyModeUI(){
 $('topology-overview').hidden=!topologyProject;$('topology-system-label').hidden=!topologyProject;
 $('topology-system-label').textContent=topologyProject?`Project · ${projects().find(p=>p.hash===topologyProject)?.name||topologyProject} · ${topologyScope().agents.length} agents`:'';
 $('topology-mode-hint').textContent='Double-click a parent to expand/collapse · right-click for actions · drag to pan · scroll to zoom';
}
updateTopologyModeUI();
$('topology-overview').addEventListener('click',()=>showProject(''));
$('topology-expand-all').addEventListener('click',()=>{topologyFit=true;topologyView?.expandAll(true)});
$('topology-collapse-all').addEventListener('click',()=>{topologyFit=true;topologyView?.expandAll(false)});
el.contextMenu.addEventListener('keydown',event=>{const buttons=[...el.contextMenu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus()}});
$('topology-search').addEventListener('input',event=>{topologyQuery=event.target.value.trim().toLowerCase().slice(0,120);topologySignature='';renderTopology()});
$("topology-zoom-in").addEventListener("click",()=>zoomTopology(1.25));
$("topology-zoom-out").addEventListener("click",()=>zoomTopology(.8));
$("topology-fit").addEventListener("click",()=>{topologyFit=true;applyTopologyZoom()});
new ResizeObserver(applyTopologyZoom).observe($("topology-canvas"));
{const canvas=$('topology-canvas');let drag;
 canvas.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;drag={x:event.clientX,y:event.clientY};canvas.classList.add('graph-panning')});
 window.addEventListener('pointermove',event=>{if(!drag)return;topologyFit=false;topologyView?.pan(event.clientX-drag.x,event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;$('topology-fit').setAttribute('aria-pressed','false')});
 for(const type of ['pointerup','pointercancel','blur'])window.addEventListener(type,()=>{drag=null;canvas.classList.remove('graph-panning')});
}
let nativeGesture=false,gestureScale=1;
$('topology-canvas').addEventListener('wheel',event=>{event.preventDefault();if(nativeGesture)return;const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?300:1);zoomTopology(Math.exp(-Math.max(-120,Math.min(120,delta))*.0025),event.clientX,event.clientY)},{passive:false,capture:true});
$('topology-canvas').addEventListener('gesturestart',event=>{event.preventDefault();nativeGesture=true;gestureScale=1},{passive:false});
$('topology-canvas').addEventListener('gesturechange',event=>{event.preventDefault();if(Number.isFinite(event.scale)&&event.scale>0){zoomTopology(event.scale/gestureScale,event.clientX,event.clientY);gestureScale=event.scale}},{passive:false});
$('topology-canvas').addEventListener('gestureend',event=>{event.preventDefault();nativeGesture=false},{passive:false});
window.addEventListener('blur',()=>{nativeGesture=false});
let liveEvents=new EventSource("/api/events");liveEvents.onmessage=()=>scheduleRefresh();
window.addEventListener("pagehide",event=>{liveEvents.close();clearTimeout(refreshTimer);refreshTimer=null;if(!event.persisted){topologyView?.kill();topologyView=undefined}});
window.addEventListener('pageshow',event=>{if(event.persisted){liveEvents=new EventSource('/api/events');liveEvents.onmessage=()=>scheduleRefresh();topologySignature='';renderTopology();scheduleRefresh(0)}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(refreshTimer);refreshTimer=null}else{if(stateLoaded){topologySignature='';renderMessages()}scheduleRefresh(0)}});
void refresh();setInterval(()=>scheduleRefresh(0),1500);

// A read-only guided preview: only local tabs, collapse state and scroll positions change.
(function initializeTutorial(){
 const dialog=$('mesh-tour'),card=$('tour-card'),highlight=$('tour-highlight');
 const steps=[
  ['.topbar','Welcome to Agent Mesh','This walkthrough shows how to monitor agents, read conversations and steer work. Use Next or Previous, or your left/right arrow keys. Exit returns you to your previous view.'],
  ['.topology-panel','Understand the topology','Channel and agent nodes show who is connected. Green means working, orange idle and grey offline. Solid links mark an active channel; dashed links mean joined only. Click a node after the tour to filter its conversation.',null,'explorer',true],
  ['.topology-tools','Focus a project','Radial project islands contain channels and real parent/child agent groups. Double-click a parent to fold or unfold its branch; other islands make room and the selected group stays in view. Right-click any node for its type-specific actions, project Kanban or project-only view. Drag to pan and scroll to zoom.',null,'explorer',true],
  ['.topology-search','Focus on an agent or channel','Search names, projects, models or statuses. Matches are highlighted along with connected spheres; unrelated nodes fade. Clear search to restore the full graph.',null,'explorer',true],
  ['.channel-panel','Browse channels','Select a channel to open its conversation. Project/folder names identify shared project channels. The red × here closes the actual channel while keeping history and project files; the × on a conversation tab only closes that tab. The protected #user inbox is for user interventions and agent replies to you—not peer-to-peer coordination.',null,'explorer'],
  ['.participant-panel','Find and configure a participant','Click the Channels or Participants heading to fold or unfold that panel. Right-click an agent here or in the topology to open its configuration tab and request its exact Pi model and thinking level. The target Pi session applies the change when idle and reports an acknowledgment; an active approved child job cannot be reconfigured.',null,'explorer'],
  ['#inspector-toggle','Focus your workspace','Collapse the right panel with its arrow. Alt+T shows only topology; Alt+M shows only messages; Alt+R returns to all three panels. Browser-reserved shortcuts may require using the visible controls.',null,'explorer'],
  ['#matrix-panel','Check memberships at a glance','The matrix separates activity Status from channel membership. Selected marks the active peer channel; Joined is membership only. Click a channel cell to read its conversation. Headers remain visible while you scroll.','matrix'],
  ['#timeline-main','Read and navigate messages','All messages shows the timeline; channel tabs narrow it down. Each message records its sender, destination, intent and time. Select a message and use arrow keys to browse after closing this walkthrough.','all'],
  ['.top-actions','Keep up with live work','Auto-scroll follows new messages; turn it off when reading history. Jump to latest returns to the newest message. Adjust text size or switch the theme here. Export downloads the message history.'],
  ['#composer','Send a user intervention','Open Intervene & manage. Choose All agents, a specific agent or selected recipients, choose an intent, and write your direction. Enter sends; Shift+Enter adds a newline. The tour never sends anything.','all','controls'],
  ['#membership','Manage agent access','Agent access is collapsed by default; click its heading to expand it. Choose an agent and a channel, then Join channel or Kick from channel. Remove agent disconnects that identity from Mesh. These are real management actions—review the selection before using them.',null,'controls'],
  ['.mesh-controls','Use policy controls carefully','Mesh controls is collapsed by default. Click its heading to expand it, then block a selected project or kick participants matching a status. The top-bar Mesh enabled switch controls Mesh globally. These affect running coordination and approved work; no switches are changed by this tutorial.',null,'controls'],
  ['#fleet-panel','Monitor durable workflows','Work fleet lists approved jobs. Filter by project, then select a run to inspect its steps, usage, output, workspaces and receipts. Use /mesh jobs in Pi to launch or resume work with explicit approval.','fleet'],
  ['#fleet-panel','Steer work and verify the outcome','After selecting a run, Stop cancels it; Pause takes effect between steps; Continue releases a pause. Send steering adds direction within approved limits. Read the receipt: queued is not proof the model followed it. Completed does not mean changes were merged or deployed.','fleet'],
  ['#help-tour','You are ready','Exit to return to your previous view. Reopen Help any time to repeat this walkthrough. Start by checking memberships, reading the relevant channel, then choosing a specific recipient or job before intervening.']
 ];
 let index=0,saved,timer;
 const clickView=view=>document.querySelector(`[data-view="${CSS.escape(view)}"]`)?.click();
 function position(){
  if(!dialog.open)return;
  const target=document.querySelector(steps[index][0]),r=target?.getBoundingClientRect();
  const visible=r&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;
  highlight.hidden=!visible;
  if(visible){const x=Math.max(4,r.left-4),y=Math.max(4,r.top-4);Object.assign(highlight.style,{left:x+'px',top:y+'px',width:Math.max(0,Math.min(innerWidth-4,r.right+4)-x)+'px',height:Math.max(0,Math.min(innerHeight-4,r.bottom+4)-y)+'px'})}
  const w=card.offsetWidth,h=card.offsetHeight;
  let x=visible?r.left:((innerWidth-w)/2),y=visible&&r.bottom+h+20<innerHeight?r.bottom+12:visible&&r.top>h+20?r.top-h-12:innerHeight-h-12;
  card.style.left=Math.max(12,Math.min(innerWidth-w-12,x))+'px';card.style.top=Math.max(12,y)+'px';
 }
 function show(){
  const [selector,title,description,view,inspector,expand]=steps[index];
  const section=document.querySelector(selector)?.closest('.context-panel,.compose');if(section?.querySelector('.section-toggle'))setSection(section,false,false);
  if(view)clickView(view);
  if(inspector)$(inspector+'-tab').click();
  if(expand&&$('topology-toggle').getAttribute('aria-expanded')==='false')$('topology-toggle').click();
  $('tour-title').textContent=title;$('tour-description').textContent=description;
  $('tour-progress').textContent=`Step ${index+1} of ${steps.length}`;
  $('tour-previous').disabled=index===0;$('tour-next').disabled=index===steps.length-1;
  document.querySelector(selector)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  position();$('tour-title').focus({preventScroll:true});
 }
 function exit(){if(dialog.open)dialog.close()}
 $('help-tour').addEventListener('click',()=>{
  if(dialog.open)return;
  saved={sections:[...document.querySelectorAll('.section-toggle')].map(b=>({id:b.closest('.context-panel,.compose').id,collapsed:b.getAttribute('aria-expanded')==='false'})),participant:selectedParticipant,channel:selectedChannel,storedChannel:localStorage.getItem(channelKey),recipient:el.to.value,member:el.memberAgent.value,view:activeView,inspector:document.querySelector('[data-inspector][aria-selected="true"]')?.id,expanded:$('topology-toggle').getAttribute('aria-expanded'),inspectorCollapsed:workspace.classList.contains('inspector-collapsed'),focusMode,scroll:[...document.querySelectorAll('.workspace *')].filter(n=>n.scrollHeight>n.clientHeight||n.scrollWidth>n.clientWidth).map(n=>({node:n,id:n.id,cls:n.className,top:n.scrollTop,left:n.scrollLeft}))};
  setFocusMode('normal',false);setInspectorCollapsed(false,false);index=0;dialog.showModal();show();timer=setInterval(position,250);
 });
 $('tour-next').addEventListener('click',()=>{if(index<steps.length-1){index++;show()}});
 $('tour-previous').addEventListener('click',()=>{if(index>0){index--;show()}});
 $('tour-exit').addEventListener('click',exit);
 dialog.addEventListener('cancel',event=>{event.preventDefault();exit()});
 document.addEventListener('keydown',event=>{
  if(!dialog.open)return;
  if(['ArrowLeft','ArrowRight','Escape'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape')exit();else $(event.key==='ArrowRight'?'tour-next':'tour-previous').click()}
  if(event.key==='Tab'){event.preventDefault();event.stopImmediatePropagation();const buttons=[...card.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);buttons[i<0?(event.shiftKey?buttons.length-1:0):(i+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus()}
 },true);
 dialog.addEventListener('close',()=>{
  clearInterval(timer);setFocusMode(saved.focusMode,false);setInspectorCollapsed(saved.inspectorCollapsed,false);for(const section of saved.sections)setSection($(section.id),section.collapsed,false);activeView=saved.view;selectedParticipant=saved.participant;selectedChannel=saved.channel;
  if(saved.storedChannel===null)localStorage.removeItem(channelKey);else localStorage.setItem(channelKey,saved.storedChannel);
  renderAgents();renderChannels();renderMessages();el.to.value=saved.recipient;el.memberAgent.value=saved.member;
  if(saved.inspector)$(saved.inspector)?.click();
  if($('topology-toggle').getAttribute('aria-expanded')!==saved.expanded)$('topology-toggle').click();
  for(const item of saved.scroll){const node=item.node.isConnected?item.node:item.id?$(item.id):typeof item.cls==='string'&&item.cls?document.getElementsByClassName(item.cls)[0]:null;if(node){node.scrollTop=item.top;node.scrollLeft=item.left}}
  $('help-tour').focus({preventScroll:true});
 });
 window.addEventListener('resize',position);
 const location=new URL(window.location.href);
 if(location.searchParams.get('tour')==='1'){
  location.searchParams.delete('tour');history.replaceState(history.state,'',location.pathname+location.search+location.hash);
  $('help-tour').click();
 }
})();
