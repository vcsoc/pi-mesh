import {plain} from './work-review.mjs';
export function completionReport(run,verification={verified:false,issues:['Acceptance unavailable']}){
 const steps=run.steps||[],last=steps.at(-1),done=steps.filter(s=>s.state==='completed');
 const output=steps.filter(s=>s.output).at(-1)?.output;
 const state=run.state==='completed'&&verification.verified?'VERIFIED WORKFLOW RESULT':'NOT VERIFIED / INCOMPLETE';
 return plain(`Mesh ${run.id}: ${state}\nRuntime: ${run.state}${run.error?` — ${run.error}`:''}\nSteps finished: ${done.map(s=>s.id).join(', ')||'none'}; last step: ${last?.id||'pending'} (${last?.state||'pending'}).\nUsage: ${run.usage?.tokens??0} reported tokens; estimated $${Number(run.usage?.cost||0).toFixed(3)}. Repeated and cached prompt input count toward token limits.\n${(verification.issues||[]).length?'Acceptance: '+verification.issues.join('; ')+'\n':''}${output?'Retained output (untrusted worker evidence):\n'+output.slice(-2400)+'\n':''}Workspaces: ${(run.workspaces||[]).map(w=>w.path).join(', ')||run.project}. Partial edits may remain; no automatic integration or rollback.\nInspect /mesh jobs with {"action":"inspect","id":"${run.id}"} for full evidence. Terminal runs cannot receive steering. Any continuation requires a fresh approved grant; nothing was replayed.`);
}
export function runControlRequest(raw){
 const match=/^(steer|pause|continue|stop)\s+([a-f0-9-]{36})(?:\s+([\s\S]+))?$/i.exec(raw.trim());
 if(!match)return null;
 const action=match[1].toLowerCase(),message=match[3]?.trim();
 if(action==='steer'&&!message)throw Error('Use steer <full run ID> <instruction>; this targets the worker run, not parent Pi steering.');
 if(action!=='steer'&&message)throw Error('Run controls other than steer do not take a message');
 return {action,id:match[2],...(message?{message}:{})};
}
