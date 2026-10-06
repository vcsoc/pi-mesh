// Deterministic local SDK fixture. No model/network requests.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
export const ModelRuntime={create:async()=>({getModel:(provider,id)=>({provider,id})})};
export const createExtensionRuntime=()=>({});
export const SettingsManager={inMemory:value=>value};
export const SessionManager={create:(cwd,dir)=>{mkdirSync(dir,{recursive:true});const path=join(dir,'session.jsonl');writeFileSync(path,'{"type":"session"}\n');return {path}},open:path=>({path})};
export async function createAgentSession(options) {
 if(options.resourceLoader.getExtensions().extensions.length)throw new Error('Ambient extensions must be absent');
 let listener,resolve,aborted=false,timer;const messages=[];
 const session={sessionFile:options.sessionManager.path,messages,subscribe(fn){listener=fn;return()=>{}},async prompt(text){aborted=false;appendFileSync(options.sessionManager.path,JSON.stringify({type:'prompt',text})+'\n');await new Promise(r=>{resolve=r;timer=setTimeout(r,text.includes('slow')?1500:20)});const message={role:'assistant',content:[{type:'text',text:'{"verdict":"pass"}'}],stopReason:aborted?'aborted':'stop',usage:{totalTokens:11,cost:{total:0}}};messages.push(message);listener({type:'message_end',message})},getLastAssistantText:()=>'{"verdict":"pass"}',async steer(text){appendFileSync(options.sessionManager.path,JSON.stringify({type:'steering',text})+'\n')},async abort(){aborted=true;clearTimeout(timer);resolve?.()},dispose(){clearTimeout(timer)}};
 return {session};
}
