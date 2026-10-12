import { getPackageDir, getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { resolveSDKFile, nodeExecutable } from '../fleet.mjs';

const execute = promisify(execFile);
const runner = fileURLToPath(new URL('../runner.mjs', import.meta.url));
async function probe(kind: 'sdk' | 'extension', cwd: string): Promise<string> {
 const agentDir = getAgentDir();
 const sdkFile = process.env.PI_SDK_ROOT ? join(process.env.PI_SDK_ROOT, 'dist', 'index.js') : resolveSDKFile(getPackageDir(), agentDir);
 const script = `
 import {pathToFileURL} from 'node:url';
 import {join} from 'node:path';
 const {sdkFile,agentDir,cwd,kind,runner}=JSON.parse(process.argv[1]);
 const sdk=await import(pathToFileURL(sdkFile).href);
 const {sdkFactory}=await import(pathToFileURL(runner).href);
 const runtime=await sdk.ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:join(agentDir,'models.json')});
 const model=runtime.getModels()[0];
 if(!model)throw Error('SDK has no built-in models');
 const factory=await sdkFactory({sdkFile,agentDir,project:cwd,systemPrompt:'SDK construction test only; never prompt',thinkingLevel:'off'},join(agentDir,'sdk-test'));
 const extension=kind==='extension';
 const {selectedExtensions}=await import(new URL('./child-extensions.mjs',pathToFileURL(runner)));
 const extensions=extension?selectedExtensions(agentDir,['extensions/mesh-review-fixture.mjs']):[];
 const session=await factory({key:kind,profile:'scout',model:model.provider+'/'+model.id,tools:['read'],extensions,extensionTools:extension?['mesh_fixture_tool']:[],prompt:'Never prompt a model'},cwd);
 try{console.log(JSON.stringify(extension?{extensionProbe:true,tools:session.getActiveToolNames(),commands:session.extensionRunner.getRegisteredCommands().map(c=>c.name),loaded:extensions.map(e=>e.name)}:{sdkProbe:true,tools:session.getActiveToolNames(),sessionFile:session.sessionFile}))}finally{session.dispose()}
 `;
 const { stdout } = await execute(nodeExecutable(), ['--input-type=module', '-e', script, JSON.stringify({sdkFile,agentDir,cwd,kind,runner})], { timeout: 10000, env: {...process.env, PI_OFFLINE: '1'} });
 return stdout.trim();
}

export default function(pi: ExtensionAPI) {
 pi.registerCommand('inspect-mesh-model', {handler: async(_args,ctx) => ctx.ui.notify(JSON.stringify({model:ctx.model?`${ctx.model.provider}/${ctx.model.id}`:null,thinking:pi.getThinkingLevel(),levels:ctx.model?getSupportedThinkingLevels(ctx.model):[]}), 'info')});
 pi.registerCommand('inspect-mesh-tools', {handler: async(_args,ctx) => ctx.ui.notify(JSON.stringify(pi.getAllTools().map(t=>t.name).filter(n=>n.startsWith('agent_mesh_')).sort()), 'info')});
 pi.registerCommand('inspect-mesh-child-extension', {handler: async(_args,ctx) => ctx.ui.notify(await probe('extension', ctx.cwd), 'info')});
 pi.registerCommand('inspect-mesh-sdk', {handler: async(_args,ctx) => ctx.ui.notify(await probe('sdk', ctx.cwd), 'info')});
}
