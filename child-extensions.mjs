import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';

const roots=['extensions','git','npm'];
const entry=['index.ts','index.js','index.mjs'];
function approvedPath(agentDir,name){
 if(typeof name!=='string'||name.length>240||name.includes('\\')||name.split('/').some(part=>!part||part==='.'||part==='..')||!roots.includes(name.split('/')[0])||name.split('/').length<2)throw new Error('Child extension must name an installed agent-directory extension path');
 const root=realpathSync(agentDir),resolved=realpathSync(join(root,name)),rel=relative(root,resolved);
 if(!rel||rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel)||!roots.includes(rel.split(sep)[0]))throw new Error('Child extension resolves outside installed agent resources');
 const stat=lstatSync(resolved);
 if(stat.isDirectory()){
  if(!entry.some(file=>existsSync(join(resolved,file))))throw new Error('Child extension directory requires index.ts, index.js, or index.mjs');
 }else if(!stat.isFile()||!/[.]([cm]?js|ts)$/.test(resolved))throw new Error('Child extension must be a TypeScript/JavaScript entry point');
 if(rel.split(sep).some(part=>part==='agent-mesh'))throw new Error('Mesh cannot be loaded recursively into a child');
 return resolved;
}
function fingerprint(path){
 const hash=createHash('sha256');let files=0,bytes=0;
 const walk=(file,label)=>{
  const stat=lstatSync(file);
  if(stat.isSymbolicLink())throw new Error('Child extension contains an unverified symlink');
  if(stat.isDirectory()){
   for(const name of readdirSync(file).sort())walk(join(file,name),`${label}/${name}`);
  }else if(stat.isFile()){
   files++;bytes+=stat.size;if(files>4000||bytes>128*1024*1024)throw new Error('Child extension exceeds integrity snapshot limits');
   hash.update(label+'\0');hash.update(readFileSync(file));
  }else throw new Error('Child extension has an unsupported filesystem entry');
 };
 walk(path,'.');return hash.digest('hex');
}
export function selectedExtensions(agentDir,names){
 if(!Array.isArray(names)||names.length>1||names.some(name=>typeof name!=='string'))throw new Error('Choose at most one installed child extension per task');
 const selected=names.map(name=>{const path=approvedPath(agentDir,name);return {name,path,sha256:fingerprint(path)}});
 if(new Set(selected.map(item=>item.path)).size!==selected.length)throw new Error('Duplicate child extension');
 return selected;
}
export function verifySelectedExtensions(agentDir,selected){
 if(!Array.isArray(selected)||selected.length>1)throw new Error('Invalid approved child extension snapshot');
 for(const item of selected){
  const current=selectedExtensions(agentDir,[item.name])[0];
  if(current.path!==item.path||current.sha256!==item.sha256)throw new Error(`Installed child extension changed after approval: ${item.name}`);
 }
 return selected.map(item=>item.path);
}
