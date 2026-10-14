import { getAgentDir, getPackageDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import { Text } from '@earendil-works/pi-tui';
import { workflowSummaryLines, workflowReviewLines } from './work-review.mjs';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadProfiles, savedWorkflows, forkContext, toolCeiling } from './workflow.mjs';
import { launchRun, waitRun, canonicalProject, projectHash, resolveSDKFile, resumeSpecification, integrationEvidence, runVerification, updateMission, listMissions, runEvents } from './fleet.mjs';
import { readRun, listRuns, runDirectory, enqueueControl, controlReceipt, terminal, atomicJSON, readJSON, storeLock, ownsLiveProcess } from './fleet-store.mjs';
import { roleMemory } from './context-memory.mjs';
import { quickWorkRequest } from './quick-work.mjs';
import { teamWorkRequest } from './team-work.mjs';
import { demoWorkRequest, demoReport, DEMO_USAGE, DEMO_SYSTEM_PROMPT } from './demo-work.mjs';
import { reviewWork } from './work-tui.ts';
import { simpleTeam, simpleProposal } from './simple-team.ts';
import { compileScopedWorkflow } from './team-scope.mjs';
import { createRunStatus } from './run-status.mjs';
import {completionReport,runControlRequest} from './completion.mjs';
import {readGatewayConfig} from './security/gateway/client.mjs';
import { mergeWorkspaces, cleanupWorkspace, preflightWorkspace } from './workspace.mjs';

export function registerWork(pi: ExtensionAPI, getDirectory: () => string, available: () => Promise<void>, connection: () => { base: string; token: string }) {
 const foreground=new Set<string>();
 const editAgain=Symbol('edit-again');
 const status=createRunStatus({directory:getDirectory,projectOf:(ctx:any)=>canonicalProject(ctx.cwd),list:listRuns,read:readRun,onFinish:(run:any)=>{
  const spec=readJSON(join(runDirectory(getDirectory(),run.id),'spec.json'));
  pi.sendMessage?.({customType:'mesh-result',content:spec.plan.scope==='demo'?demoReport(run,spec):completionReport(run,runVerification(run,spec)),display:true},{triggerTurn:false});
 }});
 pi.on('session_start',async(_event,ctx)=>status.start(ctx));
 pi.on('session_switch',async(_event,ctx)=>status.start(ctx));
 const profiles=(ctx:any)=>loadProfiles(getAgentDir(),canonicalProject(ctx.cwd));
 async function approve(ctx:any,title:string,description:string,signal?:AbortSignal) {
  if(!ctx.hasUI||!await ctx.ui.confirm(title,description,{signal}))throw new Error('Explicit interactive approval is required');
 }
 async function operate(params:any,ctx:any,signal?:AbortSignal,allowBack=false,approvedSummary?:string):Promise<any> {
  status.start(ctx);
  const directory=getDirectory(),project=canonicalProject(ctx.cwd),action=params.action||'list';
  const own=(id:string)=>{const run=readRun(directory,id);if(run.project!==project)throw new Error('Run belongs to another project');return run};
  if(action==='profiles')return profiles(ctx);
  if(action==='context')return roleMemory(project,params.role||'orchestrator');
  if(action==='workflows')return savedWorkflows(getAgentDir(),project);
  if(action==='models')return {current:ctx.model?`${ctx.model.provider}/${ctx.model.id}`:null,available:(await ctx.modelRegistry.getAvailable()).map((m:any)=>`${m.provider}/${m.id}`)};
  if(action==='enable') {pi.setActiveTools([...new Set([...pi.getActiveTools(),'agent_mesh_work'])]);return {enabled:true,launched:0};}
  if(action==='list')return listRuns(directory,project);
  if(action==='missions')return listMissions(directory,project);
  if(action==='mission') {
   await approve(ctx,'Update Mesh mission?',JSON.stringify(params.definition||{}),signal);
   return updateMission(directory,project,params.definition||{});
  }
  if(['inspect','wait','stop','steer','pause','continue','receipt'].includes(action)) {
   own(params.id);
   if(action==='inspect'){const run=own(params.id),spec=readJSON(join(runDirectory(directory,params.id),'spec.json'));return {run,verification:runVerification(run,spec),events:runEvents(directory,params.id)};}
   if(action==='receipt')return controlReceipt(directory,params.id,params.receipt);
   if(action==='wait'){const run=await waitRun(directory,params.id,{signal,timeoutMs:params.waitMs??30000});return {...run,verification:runVerification(run,readJSON(join(runDirectory(directory,params.id),'spec.json')))};}
   return enqueueControl(directory,params.id,action,params.message);
  }
  if(['merge','cleanup'].includes(action)) {
   const run=own(params.id);if(ownsLiveProcess(run))throw new Error('Finish or stop the run first');
   const selected=params.lane?run.workspaces.filter(w=>w.lane===params.lane):run.workspaces;
   const workspace=selected[0];if(!workspace||action==='cleanup'&&selected.length>1)throw new Error('Select an existing workspace lane');
   if(listRuns(directory).some(r=>ownsLiveProcess(r)&&r.workspaces.some(w=>selected.some(s=>s.path===w.path))))throw new Error('Workspace is in use by a live runner');
   if(action==='merge')integrationEvidence(run,readJSON(join(runDirectory(directory,params.id),'spec.json')));
   await approve(ctx,action==='merge'?'Apply Mesh changes to your index?':'Remove managed Mesh worktree?',`${selected.map(w=>`${w.path}\n${w.evidence?.stat||''}`).join('\n')}\n${params.discard?'DISCARD any unintegrated changes.':'Unintegrated changes will be retained.'}\nNo commit or push.`,signal);
   const file=join(runDirectory(directory,params.id),`integration-${workspace.lane}.json`);
   return storeLock(directory,'workspace',async()=>{
    if(action==='merge'){const result=await mergeWorkspaces(directory,selected);for(const receipt of result)atomicJSON(join(runDirectory(directory,params.id),`integration-${receipt.lane}.json`),receipt);return result;}
    return cleanupWorkspace(directory,workspace,{discard:params.discard===true,receipt:existsSync(file)?readJSON(file):undefined});
   });
  }
  if(!['run','resume','preview'].includes(action))throw new Error('Unknown work action');
  await available();
  if(process.env.PI_MESH_CHILD)throw new Error('Nested delegation is disabled');
  if(!ctx.model)throw new Error('Select a model before delegation');
  const currentModel=`${ctx.model.provider}/${ctx.model.id}`;
  const availableModels=(await ctx.modelRegistry.getAvailable()).map((m:any)=>`${m.provider}/${m.id}`);
  let definition=params.definition||params;
  if(params.workflow) {definition=savedWorkflows(getAgentDir(),project)[params.workflow];if(!definition)throw new Error('Unknown saved workflow');}
  let spec:any;
  if(action==='resume') {
   spec=resumeSpecification(directory,params.id,project);
   if(params.message) {
    if(typeof params.message!=='string'||params.message.length>12000)throw new Error('Invalid continuation message');
    const last=spec.plan.stages.at(-1).tasks.at(-1);last.task+='\n\nUser continuation:\n'+params.message;
    spec.completedSteps=spec.completedSteps.filter(s=>s.id!==last.id);
   }
   spec.systemPrompt+='\n\nCurrent parent constraints:\n'+ctx.getSystemPrompt();
   if(spec.plan.untilComplete)spec.costApprovalBase=spec.priorUsage?.cost||0;
   // New approval cannot resurrect a removed tool or model permission.
   for(const stage of spec.plan.stages)for(const t of stage.tasks) {
    if(!availableModels.includes(t.model)||t.tools.some((tool:string)=>!toolCeiling(pi.getActiveTools()).has(tool)))throw new Error('Resume exceeds current model/tool availability');
   }
  } else {
   const plan=compileScopedWorkflow(definition,profiles(ctx),{activeTools:pi.getActiveTools(),currentModel,availableModels,agentDir:getAgentDir()});
   spec={plan,cwd:ctx.cwd,project,projectHash:projectHash(project),systemPrompt:plan.scope==='demo'?DEMO_SYSTEM_PROMPT:ctx.getSystemPrompt(),thinkingLevel:ctx.thinkingLevel||pi.getThinkingLevel(),sdkFile:join(getPackageDir(),'dist','index.js'),agentDir:getAgentDir(),forkContext:plan.context==='fork'?forkContext(ctx.sessionManager.buildContextEntries()):'',missionId:params.missionId||definition.missionId};
  }
  if(spec.plan.stages.some(s=>s.tasks.some(t=>t.acceptance.some(g=>g.type==='command')))&&!pi.getActiveTools().includes('bash'))throw new Error('Host command gates require the parent bash capability');
  if(spec.missionId&&!listMissions(directory,project).some(m=>m.id===spec.missionId&&m.status==='open'))throw new Error('Choose an open mission in this project');
  spec.parentId=ctx.sessionManager.getSessionId();spec.policyDirectory=directory;spec.mesh=connection();spec.gatewayMode=readGatewayConfig().mode;
  if(spec.plan.untilComplete&&spec.plan.tokenLimitMode&&spec.gatewayMode!=='routed')throw Error('Automatic continuation requires gateway routing for complete SDK request auditing. Configure /ai-gateway first; no work started.');
  const summary={project,gateway:{mode:spec.gatewayMode,confinement:'unverified',audit:'metadata-default'},scope:spec.plan.scope||'custom',workingDirectory:spec.cwd,missionId:spec.missionId,planFingerprint:createHash('sha256').update(JSON.stringify(spec.plan)).digest('hex'),contextFingerprint:createHash('sha256').update(JSON.stringify([spec.systemPrompt,spec.forkContext||''])).digest('hex'),isolation:spec.plan.isolation,context:spec.plan.context,thinkingLevel:spec.thinkingLevel,background:params.background===true,schedule:spec.plan.schedule,continuation:{untilComplete:spec.plan.untilComplete===true,unlimitedSpending:spec.plan.maxCost===null,interventions:'cancel active operation, process first, then resume',failurePolicy:'pause after three failed acceptance passes'},limits:{concurrency:spec.plan.concurrency,spawns:spec.plan.maxCalls,tokens:spec.plan.maxTokens,tokenLimitMode:spec.plan.tokenLimitMode,estimatedCost:spec.plan.maxCost,costApprovalBase:spec.costApprovalBase||0,childDeadlineMs:spec.plan.timeoutMs},steps:spec.plan.stages.map(s=>({parallel:s.parallel,retries:s.retries,when:s.when,tasks:s.tasks.map(t=>({id:t.id,role:t.profile,lane:t.lane,model:t.model,write:t.write,tools:t.tools,extensions:t.extensions,extensionTools:t.extensionTools,task:t.task,prompt:t.prompt,acceptance:t.acceptance}))}))};
  if(action==='preview')return summary;
  spec.sdkFile=resolveSDKFile(getPackageDir(),getAgentDir());
  if(spec.plan.isolation==='worktree'&&spec.plan.stages.some(s=>s.tasks.some(t=>t.write&&!spec.resumeWorkspaces?.some(w=>w.lane===t.lane))))await preflightWorkspace(spec.cwd);
  // Only this command's private UI return can supply a grant; tool parameters cannot.
  if(approvedSummary!==undefined&&approvedSummary!==JSON.stringify(summary)) {
   ctx.ui.notify('The execution plan changed. Check the updated settings before accepting again.','warning');
   if(allowBack)return editAgain;
   throw new Error('Execution approval no longer matches the plan');
  }
  const decision=approvedSummary!==undefined?'approve':await reviewWork(ctx,summary,signal,allowBack);
  if(decision==='back'&&allowBack)return editAgain;
  if(decision!=='approve'||signal?.aborted)throw new Error('Approval cancelled — no work started');
  await available();
  const stillAvailable=(await ctx.modelRegistry.getAvailable()).map((m:any)=>`${m.provider}/${m.id}`),ceiling=toolCeiling(pi.getActiveTools());
  if(spec.plan.stages.some(s=>s.tasks.some(t=>!stillAvailable.includes(t.model)||t.tools.some(tool=>!ceiling.has(tool)))))throw new Error('Model/tool availability changed during review; open a new review. No work started.');
  if(signal?.aborted)throw new Error('Approval cancelled — no work started');
  if(readGatewayConfig().mode!==spec.gatewayMode)throw Error('Gateway mode changed; approve a fresh preview');
  const run=launchRun(directory,spec);
  status.track(run,ctx);
  if(params.background===true)return run;
  foreground.add(run.id);
  try{const finished=await waitRun(directory,run.id,{signal,onUpdate:state=>ctx.ui.setWidget('mesh-jobs',[`${state.id.slice(0,8)} · ${state.state} · ${state.steps.length} steps · ${state.usage.tokens} tokens`])});return {...finished,verification:runVerification(finished,spec)};}
  finally{foreground.delete(run.id);ctx.ui.setWidget('mesh-jobs',undefined);}
 }
 const actions=['enable','context','profiles','models','workflows','preview','run','resume','list','inspect','wait','stop','steer','pause','continue','receipt','missions','mission','merge','cleanup'] as const;
 pi.registerTool({name:'agent_mesh_work',label:'Mesh Work',description:'Explicitly approved durable Mesh workflows, profiles, schedules, missions and isolated worktrees. Preview before run. Background jobs survive Pi exit. Inspect/list/wait/stop/steer/pause/continue use a run id; control receipts distinguish queued from applied. See /mesh jobs help for the declarative definition format.',
  promptSnippet:'Run explicitly authorized Mesh workflows and inspect/control durable child jobs.',
  promptGuidelines:['Task complexity does not authorize delegation. Use profiles/workflows/preview without launching work. Every run/resume requires interactive user approval; no nested delegation. Report completed runtime separately from acceptance evidence.'],
  parameters:Type.Object({action:StringEnum(actions),id:Type.Optional(Type.String()),role:Type.Optional(Type.String()),workflow:Type.Optional(Type.String()),definition:Type.Optional(Type.Any({description:'Declarative workflow: tasks[{id?,profile,task,lane?,model?,extensions?:[installed agent-dir path],extensionTools?:[approved tool names],acceptance?}], mode sequence/parallel; or stages[{tasks,parallel?,retries?,when?}]. Optional isolation worktree/shared, schedule{at,everyMs,maxRuns}, untilComplete (explicit automatic checkpoint continuation), watchdog, concurrency, timeoutMs, maxCalls, maxTokens, maxCost (null permits unlimited spending only with untilComplete), context fresh/fork.'})),tasks:Type.Optional(Type.Array(Type.Object({profile:Type.String(),task:Type.String()}))),mode:Type.Optional(StringEnum(['sequence','parallel'] as const)),background:Type.Optional(Type.Boolean()),missionId:Type.Optional(Type.String()),message:Type.Optional(Type.String()),receipt:Type.Optional(Type.String()),lane:Type.Optional(Type.String()),discard:Type.Optional(Type.Boolean()),waitMs:Type.Optional(Type.Integer({minimum:1,maximum:300000}))}),
  renderCall(params,theme){return new Text(theme.fg('toolTitle',`Mesh work: ${params.action}`),0,0);},
  renderResult(result,{expanded,isPartial},theme){
   if(isPartial)return new Text(theme.fg('muted','Preparing Mesh work...'),0,0);
   const data=result.details?.result;
   if(data&&Array.isArray(data.steps)&&data.limits&&data.project){
    const lines=expanded?workflowReviewLines(data):workflowSummaryLines(data);
    return new Text((expanded?lines:[...lines.slice(0,4),...lines.filter(line=>/^Checks:|^Model:|^\d+\. /.test(line)).slice(0,7),'Expand for details. Approval opens a separate dialog']).join('\n'),0,0);
   }
   const lines=result.content.filter(part=>part.type==='text').flatMap(part=>part.text.split('\n'));
   return new Text((expanded||lines.length<=12?lines:[...lines.slice(0,12),'Expand tool output for the full response']).join('\n'),0,0);
  },
  async execute(_id,params,signal,_update,ctx){const result=await operate(params,ctx,signal),text=JSON.stringify(result,null,2);return {content:[{type:'text',text:text.length<=48000?text:JSON.stringify({id:result.id,state:result.state,notice:'Output truncated; use inspect for the run and retained evidence files.',tail:text.slice(-16000)})}],details:{result}};},
 });
 pi.on('session_shutdown',async()=>{status.stop();for(const id of foreground)try{enqueueControl(getDirectory(),id,'stop')}catch{}foreground.clear();});
 return async(args:string,ctx:any)=>{
  const raw=args.trim()||'list';
  if(/^demo(?:\s|$)/i.test(raw)) {
   if(raw.toLowerCase()==='demo help')return ctx.ui.notify(DEMO_USAGE,'info');
   const request=demoWorkRequest(raw.slice(4).trim());
   if(!ctx.hasUI)throw new Error('Mesh demo requires interactive approval. No work was started.');
   const result=await operate(request,ctx);
   return ctx.ui.notify(`Mesh demo ${result.id}: ${request.definition.demoCount} agents requested, up to ${request.definition.concurrency} concurrent; launched (${result.state}), not yet verified. Real model usage and Mesh logs. Footer tracks progress; a per-agent PASS/FAIL report follows. Stop with /mesh stop ${result.id}.`,'info');
  }
  if(raw==='review-demo') {
   if(ctx.mode!=='tui')throw new Error('The review demo requires interactive Pi TUI mode. No work was started.');
   const demo={project:ctx.cwd,workingDirectory:ctx.cwd,scope:'review',isolation:'shared',background:false,context:'fresh',thinkingLevel:'demo only',gateway:{mode:'demo — NO EXECUTION'},limits:{spawns:0,tokens:0,concurrency:0,estimatedCost:0,childDeadlineMs:0},steps:Array.from({length:4},(_,index)=>({parallel:false,retries:0,tasks:[{id:`sample-${index+1}`,role:['scout','developer','tester','reviewer'][index],lane:'sample',model:'DEMO — no model request',write:false,tools:['read (sample only)'],extensions:[],extensionTools:[],task:`SAMPLE ONLY — stage ${index+1}. This review is for testing layout, scrolling and action selection. Cancel, Reject and Accept only close this sample. No worker, shell command, model request or run is created.\nScroll through this long example to verify that the actions remain fixed at the bottom.`,prompt:'Sample instructions only. Inspect the panel appearance; do not execute this task.',acceptance:[{type:'json',required:['verdict'],equals:{verdict:'demo only'}}]}]}))};
   const choice=await reviewWork(ctx,demo,undefined,true);
   ctx.ui.notify(`Review demo closed: ${choice==='approve'?'Accept':choice==='back'?'Reject':'Cancel'}. No work started.`,'info');
   return;
  }
  if(/^team(?:\s|$)/i.test(raw)) {
   if(ctx.mode!=='tui')throw new Error('/mesh team requires interactive Pi TUI mode. No work was started.');
   if(process.env.PI_MESH_CHILD)throw new Error('Nested delegation is disabled');
   if(!ctx.model)throw new Error('Select a model before configuring a team');
   const goal=raw.slice(4).trim()||await ctx.ui.editor('What should Mesh do?','');
   if(!goal?.trim())return ctx.ui.notify('Cancelled — no work started','info');
   let draft=simpleProposal(teamWorkRequest,goal);
   for(const stage of draft.definition.stages)for(const task of stage.tasks)task.model=`${ctx.model.provider}/${ctx.model.id}`;
   for(;;) {
    const catalog=(await ctx.modelRegistry.getAvailable()).map((m:any)=>`${m.provider}/${m.id}`),roleProfiles=profiles(ctx),currentModel=`${ctx.model.provider}/${ctx.model.id}`;
    const validate=(definition:any)=>compileScopedWorkflow(definition,roleProfiles,{activeTools:pi.getActiveTools(),currentModel,availableModels:catalog,agentDir:getAgentDir()});
    const edited=await simpleTeam(ctx,draft,{factory:teamWorkRequest,profiles:roleProfiles,models:catalog,currentModel,validate,preview:(input:any)=>operate({...input,action:'preview'},ctx),preflight:async(definition:any)=>{const plan=validate(definition);if(plan.isolation==='worktree'&&plan.stages.some(s=>s.tasks.some(t=>t.write)))await preflightWorkspace(ctx.cwd);}});
    if(!edited)return ctx.ui.notify('Team cancelled — no work started','info');
    draft=edited.request;
    try {
     const result=await operate(draft,ctx,undefined,true,edited.approval);
     if(result===editAgain)continue;
     return ctx.ui.notify(`Mesh ${result.id}: launched (${result.state}), not completed. Footer tracks progress; a result/blocker report follows. To steer this run: /mesh jobs steer ${result.id} <instruction>. Parent Pi queued steering does not target this run.`,'info');
    } catch(error:any) {
     if(error.message.startsWith('Approval cancelled'))return ctx.ui.notify(error.message,'info');
     ctx.ui.notify(error.message,'error');return;
    }
   }
  }
  if(raw==='help')return ctx.ui.notify('Mesh jobs: demo <1–64 agents> (approved no-tools smoke test) | team <request> (interactive editor) | review [task] | scout [task] | profiles | models | list | workflows | missions | JSON action. Review/scout show the exact scope for interactive approval before any worker starts. Example: /mesh jobs review Check this diff for correctness and tests. See ORCHESTRATION.md for advanced workflows.','info');
  const input=runControlRequest(raw)??quickWorkRequest(raw)??(raw.startsWith('{')?JSON.parse(raw):{action:raw});
  const result=await operate(input,ctx);ctx.ui.notify(JSON.stringify(result,null,2).slice(-16000),'info');
 };
}
