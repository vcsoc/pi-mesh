import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectedExtensions, verifySelectedExtensions } from '../child-extensions.mjs';
import { compileWorkflow, loadProfiles } from '../workflow.mjs';

test('child extension selection allows only installed paths and refuses changed code',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mesh-child-extension-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const root=join(dir,'extensions'),packageDir=join(root,'reviewer-helper');mkdirSync(packageDir,{recursive:true});
 const entry=join(packageDir,'index.mjs');writeFileSync(entry,'export default () => {}\n');
 const selected=selectedExtensions(dir,['extensions/reviewer-helper']);
 const plan=compileWorkflow({tasks:[{profile:'reviewer',task:'Review this diff',extensions:['extensions/reviewer-helper']}]},loadProfiles(dir,dir),{agentDir:dir,activeTools:['read'],currentModel:'fake/model',availableModels:['fake/model']});
 assert.deepEqual(plan.stages[0].tasks[0].extensions,selected);
 assert.equal(plan.stages[0].tasks[0].tools.includes('bash'),false);
 assert.throws(()=>compileWorkflow({tasks:[{profile:'reviewer',task:'x',extensionTools:['shell_tool']}]},loadProfiles(dir,dir),{agentDir:dir,activeTools:['read'],currentModel:'fake/model',availableModels:['fake/model']}),/require a selected installed child extension/);
 assert.equal(selected.length,1);assert.equal(verifySelectedExtensions(dir,selected)[0],realpathSync(packageDir));
 assert.throws(()=>selectedExtensions(dir,['../../etc/passwd']),/installed agent-directory/);
 assert.throws(()=>selectedExtensions(dir,['/tmp/other.ts']),/installed agent-directory/);
 assert.throws(()=>selectedExtensions(dir,['extensions/agent-mesh']),/ENOENT|recursively/);
 assert.throws(()=>selectedExtensions(dir,['extensions/reviewer-helper','extensions/reviewer-helper']),/at most one/);
 writeFileSync(entry,'export default () => { /* changed */ }\n');
 assert.throws(()=>verifySelectedExtensions(dir,selected),/changed after approval/);
});
test('symlinks and paths escaping installed roots are refused',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mesh-child-symlink-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'extensions'));writeFileSync(join(dir,'outside.mjs'),'export default()=>{}');
 symlinkSync(join(dir,'outside.mjs'),join(dir,'extensions','escape.mjs'));
 assert.throws(()=>selectedExtensions(dir,['extensions/escape.mjs']),/outside installed agent resources/);
});
