import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
const exec=promisify(execFile);
export async function git(cwd,args) { const output=(await exec('git',['-C',cwd,...args],{timeout:30000,maxBuffer:4*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout;return args[0]==='diff'?output:output.replace(/\r?\n$/,''); }
export async function repository(cwd) {
 const root=realpathSync(await git(cwd,['rev-parse','--show-toplevel'])),head=await git(root,['rev-parse','HEAD']);
 return {root,head};
}
export async function preflightWorkspace(cwd) {
 const {root,head}=await repository(cwd);
 if(await git(root,['status','--porcelain','--','.',':(exclude)vault/20-projects/agent-mesh-context',':(exclude)vault/30-systems/memory-index.md']))throw new Error('Managed worktrees require a clean source repository; commit/stash deliberately or explicitly choose shared isolation');
 return {root,head};
}
export async function createWorkspace(directory,cwd,id) {
 const {root,head}=await preflightWorkspace(cwd);
 const path=resolve(directory,'worktrees',id);mkdirSync(dirname(path),{recursive:true,mode:0o700});
 await git(root,['worktree','add','--detach',path,head]);
 return {path,cwd:join(path,relative(root,realpathSync(cwd))),root,base:head};
}
function owned(directory,workspace) {
 const root=realpathSync(join(directory,'worktrees')),path=realpathSync(workspace.path),rel=relative(root,path);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Workspace is not Mesh-owned');
 return path;
}
export async function workspaceEvidence(directory,workspace) {
 const path=owned(directory,workspace);
 // Only touch the index of our own disposable worktree, never the user's index.
 await git(path,['add','--intent-to-add','--','.']);
 const patch=await git(path,['diff','--binary',workspace.base,'--']);
 return {patch,hash:createHash('sha256').update(patch).digest('hex'),status:await git(path,['status','--porcelain']),ignored:(await git(path,['status','--porcelain','--ignored'])).split('\n').filter(line=>line.startsWith('!! ')).join('\n'),stat:await git(path,['diff','--stat',workspace.base,'--'])};
}
export async function mergeWorkspace(directory,workspace) { return (await mergeWorkspaces(directory,[workspace]))[0]; }
export async function mergeWorkspaces(directory,workspaces) {
 const workspace=workspaces[0];if(!workspace)throw new Error('No workspaces selected');
 for(const item of workspaces){owned(directory,item);if(item.root!==workspace.root||item.base!==workspace.base)throw new Error('Workspace bases differ; integrate manually');}
 if(await git(workspace.root,['rev-parse','HEAD'])!==workspace.base)throw new Error('Source HEAD advanced; merge manually or rerun');
 if(await git(workspace.root,['status','--porcelain','--','.',':(exclude)vault/20-projects/agent-mesh-context',':(exclude)vault/30-systems/memory-index.md']))throw new Error('Source repository must be clean before integration');
 const evidence=[],files=new Set();
 for(const item of workspaces) {
  evidence.push(await workspaceEvidence(directory,item));
  for(const file of (await git(item.path,['diff','--name-only','-z',item.base,'--'])).split('\0').filter(Boolean)) {if(files.has(file))throw new Error(`Overlapping lane changes require manual reconciliation: ${file}`);files.add(file)}
 }
 const patch=evidence.map(e=>e.patch).join('');if(Buffer.byteLength(patch)>4*1024*1024)throw new Error('Combined patch exceeds integration limit');
 if(patch) {
  async function apply(check) { await new Promise((resolvePromise,reject)=>{
   const child=execFile('git',['-C',workspace.root,'apply',...(check?['--check']:['--index']),'-'],{timeout:30000,maxBuffer:4*1024*1024},(error)=>error?reject(error):resolvePromise());
   child.stdin.on('error',reject);child.stdin.end(patch);
  }); }
  await apply(true);await apply(false);
 }
 return evidence.map((item,index)=>({lane:workspaces[index].lane,at:new Date().toISOString(),hash:item.hash,base:workspace.base,stat:item.stat,method:'git apply --index',committed:false}));
}
export async function cleanupWorkspace(directory,workspace,{discard=false,receipt}={}) {
 const path=owned(directory,workspace),evidence=await workspaceEvidence(directory,workspace);
 if(evidence.ignored&&!discard)throw new Error('Ignored artifacts are retained; explicit discard approval required');
 if(evidence.status&&!discard&&receipt?.hash!==evidence.hash)throw new Error('Unintegrated changes retained; explicit discard approval required');
 await git(workspace.root,['worktree','remove',...(evidence.status||evidence.ignored?['--force']:[]),path]);
 return {removed:path,discarded:Boolean(evidence.ignored||(evidence.status&&receipt?.hash!==evidence.hash))};
}
