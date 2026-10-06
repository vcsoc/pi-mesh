import { getPackageDir, getAgentDir, ModelRuntime, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { sdkFactory } from '../runner.mjs';
import { selectedExtensions } from '../child-extensions.mjs';
export default function(pi:ExtensionAPI) {
 pi.registerCommand('inspect-mesh-model',{handler:async(_args,ctx)=>ctx.ui.notify(JSON.stringify({model:ctx.model?`${ctx.model.provider}/${ctx.model.id}`:null,thinking:pi.getThinkingLevel(),levels:ctx.model?getSupportedThinkingLevels(ctx.model):[]}), 'info')});
 pi.registerCommand('inspect-mesh-tools',{handler:async(_args,ctx)=>ctx.ui.notify(JSON.stringify(pi.getAllTools().map(t=>t.name).filter(n=>n.startsWith('agent_mesh_')).sort()),'info')});
 pi.registerCommand('inspect-mesh-child-extension',{handler:async(_args,ctx)=>{
  const agentDir=getAgentDir(),runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:join(agentDir,'models.json')}),model=runtime.getModels()[0];
  const factory=await sdkFactory({sdkFile:join(getPackageDir(),'dist','index.js'),agentDir,project:ctx.cwd,systemPrompt:'SDK extension construction test',thinkingLevel:'off'},join(agentDir,'sdk-child-extension-test'));
  const extensions=selectedExtensions(agentDir,['extensions/mesh-review-fixture.mjs']);
  const session=await factory({key:'extension-probe',profile:'reviewer',model:`${model.provider}/${model.id}`,tools:['read'],extensions,extensionTools:['mesh_fixture_tool'],prompt:'Never prompt a model.'},ctx.cwd);
  try{ctx.ui.notify(JSON.stringify({extensionProbe:true,tools:session.getActiveToolNames(),commands:session.extensionRunner.getRegisteredCommands().map(c=>c.name),loaded:extensions.map(e=>e.name)}),'info')}finally{session.dispose()}
 }});
 pi.registerCommand('inspect-mesh-sdk',{handler:async(_args,ctx)=>{
  // Empty test credential directory, actual installed SDK. Construct only; NEVER prompt.
  const agentDir=getAgentDir(),runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:join(agentDir,'models.json')}),model=runtime.getModels()[0];
  if(!model)throw new Error('SDK has no built-in models');
  const factory=await sdkFactory({sdkFile:join(getPackageDir(),'dist','index.js'),agentDir,project:ctx.cwd,systemPrompt:'SDK construction test',thinkingLevel:'off'},join(agentDir,'sdk-test'));
  const session=await factory({key:'probe',profile:'scout',model:`${model.provider}/${model.id}`,tools:['read'],prompt:'Do not run a model.'},ctx.cwd);
  try{ctx.ui.notify(JSON.stringify({sdkProbe:true,tools:session.getActiveToolNames(),sessionFile:session.sessionFile}),'info')}finally{session.dispose()}
 }});
}
