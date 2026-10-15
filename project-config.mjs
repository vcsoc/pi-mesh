import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {atomicJSON,storeLock} from './fleet-store.mjs';
import {profiles as builtins} from './orchestration.mjs';
export const DEFAULT_PROJECT_CONFIG={version:1,defaults:{concurrency:'auto',failurePolicy:'escalate',maxCalls:64,maxCost:10,timeoutMs:600000},profiles:{}};
const digest=text=>createHash('sha256').update(text).digest('hex');
export function validateProjectConfig(value){
 if(!value||Array.isArray(value)||typeof value!=='object'||value.version!==1||Object.keys(value).some(k=>!['version','defaults','profiles'].includes(k)))throw Error('Expected version:1, defaults and profiles only');
 const d=value.defaults||{};if(!d||Array.isArray(d)||typeof d!=='object'||Object.keys(d).some(k=>!['concurrency','failurePolicy','maxCalls','maxCost','timeoutMs'].includes(k)))throw Error('Unknown project default');
 for(const [key,min,max]of [['concurrency',1,64],['maxCalls',1,64],['timeoutMs',1000,1800000]])if(d[key]!==undefined&&!(key==='concurrency'&&d[key]==='auto')&&(!Number.isInteger(d[key])||d[key]<min||d[key]>max))throw Error(`Invalid ${key}`);
 if(d.failurePolicy!==undefined&&d.failurePolicy!=='escalate')throw Error('failurePolicy must be escalate');
 if(d.maxCost!==undefined&&(!Number.isFinite(d.maxCost)||d.maxCost<=0||d.maxCost>100))throw Error('Invalid maxCost');
 if(value.profiles!==undefined&&(!value.profiles||Array.isArray(value.profiles)||typeof value.profiles!=='object'))throw Error('profiles must be an object');
 for(const [name,p]of Object.entries(value.profiles||{})){
  if(!/^[a-z][a-z0-9_-]{0,47}$/.test(name)||!p||Array.isArray(p)||typeof p!=='object'||Object.keys(p).some(k=>!['write','tools','prompt','model'].includes(k)))throw Error('Invalid role profile');
  if(p.write!==undefined&&typeof p.write!=='boolean'||p.prompt!==undefined&&(typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>16000)||p.model!==undefined&&(typeof p.model!=='string'||!/^\S+\/\S+$/.test(p.model)))throw Error(`Invalid profile ${name}`);
  const write=p.write??builtins[name]?.write??false;
  if(p.tools!==undefined&&(!Array.isArray(p.tools)||p.tools.some(t=>!(write?['read','grep','find','ls','bash','edit','write']:['read','grep','find','ls']).includes(t))))throw Error('Invalid profile tools');
 }
 return value;
}
export function readProjectConfig(project){const path=join(project,'.pi','mesh','config.json');if(existsSync(path)&&statSync(path).size>262144)throw Error('Mesh config exceeds256KiB');const source=existsSync(path)?readFileSync(path,'utf8'):null;if(source&&Buffer.byteLength(source)>262144)throw Error('Mesh config exceeds256KiB');const value=source===null?structuredClone(DEFAULT_PROJECT_CONFIG):validateProjectConfig(JSON.parse(source));return{path,revision:source===null?null:digest(source),value,text:JSON.stringify(value,null,2)}}
export function saveProjectConfig(project,text,revision){
 if(Buffer.byteLength(text)>262144)throw Error('Mesh config exceeds256KiB');const value=validateProjectConfig(JSON.parse(text)),folder=join(project,'.pi','mesh');
 for(const path of [join(project,'.pi'),folder])if(existsSync(path)&&relative(realpathSync(project),realpathSync(path)).startsWith('..'))throw Error('Mesh configuration directory escapes project');
 mkdirSync(folder,{recursive:true,mode:0o700});
 const rel=relative(realpathSync(project),realpathSync(folder));if(rel.startsWith('..'))throw Error('Mesh configuration directory escapes project');
 return storeLock(folder,'project-config',()=>{const current=readProjectConfig(project);if(existsSync(current.path)&&lstatSync(current.path).isSymbolicLink())throw Error('Refusing to replace a symlinked project config');if(current.revision!==revision)throw Error('Configuration changed elsewhere. Reopen /mesh config; nothing was overwritten.');atomicJSON(current.path,value);return readProjectConfig(project)});
}
