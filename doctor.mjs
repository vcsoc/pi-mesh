import { existsSync, readFileSync } from 'node:fs';
import { listRuns } from './fleet-store.mjs';
import { createHash } from 'node:crypto';

// This diagnostic never starts a broker, registers an agent, or launches a worker.
export async function diagnoseMesh({configPath,version,project,model,agent,fetchHealth=fetch}) {
 const checks=[];
 const add=(name,status,detail)=>checks.push({name,status,detail});
 if(!existsSync(configPath)){
  add('configuration','FAIL','No Mesh config found. Run /mesh to initialize it, then retry /mesh doctor.');
  return {ok:false,checks};
 }
 let config;
 try {config=JSON.parse(readFileSync(configPath,'utf8'))}catch(error){add('configuration','FAIL',`Cannot read Mesh config: ${error.message}`);return {ok:false,checks}}
 if(config.host!=='127.0.0.1'||!Number.isInteger(config.port)||config.port<1024||config.port>65535||typeof config.token!=='string'||config.token.length<32||typeof config.dataDir!=='string'){
  add('configuration','FAIL','Config has invalid broker settings; inspect the local Mesh config without sharing its token.');return {ok:false,checks};
 }
 add('configuration','PASS','Local config is readable.');
 const base=`http://127.0.0.1:${config.port}`;
 try {
  const response=await fetchHealth(`${base}/health`,{signal:AbortSignal.timeout(1500)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const health=await response.json(),instance=createHash('sha256').update(config.token).digest('hex').slice(0,16);
  if(health.instance!==instance)add('broker','FAIL','Broker credentials differ from local config; do not replace or delete the config.');
  else if(health.version!==version)add('broker','FAIL',`Broker ${health.version||'unknown'} differs from loaded extension ${version}; reload Pi sessions after safely restarting the broker.`);
  else add('broker','PASS',`Broker ${health.version} responds at ${base}.`);
 } catch(error){add('broker','FAIL',`Broker unavailable at ${base}: ${error.message}. Run /mesh in a Pi session to attempt startup.`)}
 add('model',model?'PASS':'WARN',model?`Current Pi model: ${model}.`:'No current model selected; use /model before worker tasks.');
 add('session',agent?'PASS':'WARN',agent?`Registered as ${agent.name||agent.id}, active channel ${agent.activeChannel||'none'}.`:'This session has no registered Mesh identity. Run /mesh to connect.');
 try {
  const runs=listRuns(config.dataDir,project),failures=runs.filter(run=>['failed','cancelled','interrupted'].includes(run.state));
  add('fleet',failures.length?'WARN':'PASS',failures.length?`${failures.length} failed/cancelled/interrupted run(s) in this project; inspect them in Work fleet. No work was started.`:`${runs.length} run(s) in this project; no recorded failures.`);
 } catch(error){add('fleet','WARN',`Cannot read local run records: ${error.message}`)}
 return {ok:!checks.some(check=>check.status==='FAIL'),checks};
}
