import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {createAudit,usageMetadata,readPrivateJSON} from './audit.mjs';
const unavailable='Required gateway confinement is not qualified. No inference was started; host/provider fallback is forbidden.';
export const gatewayHome=()=>process.env.PI_AI_GATEWAY_HOME||join(homedir(),'.pi','ai-gateway');
export function readGatewayConfig(home=gatewayHome()){
 const file=join(home,'config.json');let stat;try{stat=lstatSync(file);}catch(e){if(e.code==='ENOENT')return {mode:'audit',home};throw e;}
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.uid!==process.getuid?.())throw Error('Unsafe gateway configuration');
 const config=readPrivateJSON(file);
 if(config.version!==1||!['audit','routed','required'].includes(config.mode))throw Error('Invalid gateway mode');
 if(config.mode==='required')throw Error(unavailable);
 if(config.mode==='routed'){
  const url=new URL(config.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/')throw Error('Gateway must be authenticated loopback');
  if(typeof config.adminToken!=='string'||config.adminToken.length<32)throw Error('Gateway administration unavailable');
 }
 return {...config,home};
}
export async function gatewayRequest(config,path,data,token=config.adminToken,signal){
 const endpoint=new URL(config.url);
 if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw Error('Invalid loopback gateway endpoint');
 if(typeof config.adminToken!=='string'||config.adminToken.length<32)throw Error('Gateway server verification key unavailable');
 const requestSignal=signal||AbortSignal.timeout(path==='/v1/stream'?600000:10000);
 const nonce=randomBytes(16).toString('hex');
 const probe=await fetch(config.url+'/health?nonce='+nonce,{signal:requestSignal,redirect:'error'});
 const health=await probe.json(),{proof,nonce:returnedNonce,...claims}=health;
 const expected=createHmac('sha256',config.adminToken).update(JSON.stringify([endpoint.host,nonce,claims])).digest('hex');
 if(!probe.ok||returnedNonce!==nonce||claims.product!=='pi-ai-gateway'||claims.version!==1||typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof)||!timingSafeEqual(Buffer.from(proof),Buffer.from(expected)))throw Error('Gateway server identity proof failed; no bearer credential sent');
 const response=await fetch(config.url+path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:requestSignal,redirect:'error'});
 if(!response.ok){let code;try{code=(await response.json()).error?.code;}catch{}throw Error('Gateway: '+(code||'REQUEST_FAILED'));}
 return response;
}
export async function admit(config,identity){
 const grant=await (await gatewayRequest(config,'/v1/admit',identity)).json();
 if(typeof grant.token!=='string'||!/^[a-f0-9]{64}$/.test(grant.token)||typeof grant.agentId!=='string'||!Number.isFinite(grant.expiresAt)||grant.maxTokens!==null&&(!Number.isSafeInteger(grant.maxTokens)||grant.maxTokens<1)||grant.maxCost!==null&&(typeof grant.maxCost!=='number'||!Number.isFinite(grant.maxCost)||grant.maxCost<=0))throw Error('Invalid gateway admission receipt');
 return {...grant,_identity:{...identity,maxTokens:grant.maxTokens,maxCost:grant.maxCost}};
}
export function proxyStream(ai,config,grant,model,context,options={}){
 const output=ai.createAssistantMessageEventStream();
 (async()=>{
  try{
   const allowed=['reasoning','maxTokens','temperature','cacheRetention','transport'];
   const safeOptions=Object.fromEntries(allowed.filter(k=>options[k]!==undefined).map(k=>[k,options[k]]));
   let payload={provider:model.provider,model:model.id,context,options:safeOptions};
   const replacement=await options.onPayload?.(payload,model);if(replacement!==undefined)payload=replacement;
   if(payload?.provider!==model.provider||payload?.model!==model.id)throw Error('Gateway request model changed by a payload hook');
   if(grant._identity&&grant.expiresAt<=Date.now()+60000)Object.assign(grant,await admit(config,grant._identity));
   let response;
   try{response=await gatewayRequest(config,'/v1/stream',payload,grant.token,options.signal);}catch(error){
    // A definite pre-admission 401 is not an uncertain paid inference. Renew
    // the exact grant once, preserving server counters; never retry transport
    // failures or partial streams.
    if(error.message==='Gateway: UNAUTHORIZED'&&grant._identity){Object.assign(grant,await admit(config,grant._identity));response=await gatewayRequest(config,'/v1/stream',payload,grant.token,options.signal);}else throw error;
   }
   await options.onResponse?.({status:response.status,headers:Object.fromEntries(response.headers)},model);
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',terminal=false;
   try{
    while(!terminal){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});
     if(pending.length>32*1024*1024)throw Error('Gateway event exceeds size limit');
     let at;
     while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line)continue;
      const event=JSON.parse(line);if(event.type==='gateway-error')throw Error('Gateway: '+event.code);
      const message=event.message||event.error||event.partial;
      if(message?.model&&message.model!==model.id||message?.provider&&message.provider!==model.provider)throw Error('Gateway model provenance mismatch');
      if(event.type==='done'||event.type==='error'){terminal=true;if(message){message.gatewayRequestId=response.headers.get('x-pi-audit-request');if(event.type==='error')message.errorMessage='Gateway upstream request failed. No automatic replay; inspect gateway metadata and policy status.';}}
      await options.onProviderStreamEvent?.(event,model);output.push(event);
      if(terminal)break;
     }
    }
    if(!terminal)throw Error('Gateway stream interrupted; no automatic replay');
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   output.end();
  }catch(error){
   output.push({type:'error',reason:options.signal?.aborted?'aborted':'error',error:{role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{unknown:true,input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:options.signal?.aborted?'aborted':'error',errorMessage:`Gateway failure [${/^Gateway: [A-Z_]+$/.test(error.message||'')?error.message.slice(9):'TRANSPORT_OR_PROTOCOL_FAILURE'}]. No automatic replay; inspect gateway state`,timestamp:Date.now()}});output.end();
  }
 })();return output;
}
export function registerProxy(register,ai,config,grant,models){
 const classifiers=Object.fromEntries([...new Set(['pi-ai-gateway-classifier',...models.filter(m=>m.type==='classifier').map(m=>m.api)])].map(api=>[api,{classify:async()=>{throw Error('Classifier gateway adapter not qualified; direct fallback forbidden');}}]));
 const images=Object.fromEntries([...new Set(['pi-ai-gateway-image',...models.filter(m=>m.type==='image').map(m=>m.api)])].map(api=>[api,{generateImages:async()=>{throw Error('Image gateway adapter not qualified; direct fallback forbidden');}}]));
 for(const provider of new Set(models.map(m=>m.provider))){
  register(provider,{api:'pi-ai-gateway-chat',baseUrl:config.url,apiKey:grant.token,models:models.filter(m=>m.provider===provider).map(({headers,env,...m})=>({...m,baseUrl:config.url,api:m.type==='classifier'?'pi-ai-gateway-classifier':m.type==='image'?'pi-ai-gateway-image':'pi-ai-gateway-chat'})),classifiers,images,streamSimple:(model,context,options)=>proxyStream(ai,config,grant,model,context,options),stream:(model,context,options)=>proxyStream(ai,config,grant,model,context,options)});
 }
}
export async function createGatewayRuntime(sdk,ai,config,identity,agentDir){
 if(config.mode!=='routed')throw Error('Gateway routing is not enabled');
 const grant=await admit(config,identity),{models}=await (await gatewayRequest(config,'/v1/models',undefined,grant.token)).json();
 const runtime=await sdk.ModelRuntime.create({authPath:join(agentDir,'no-provider-credentials.json'),modelsPath:null,refreshOnCreate:false});
 registerProxy(runtime.registerProvider.bind(runtime),ai,config,grant,models);
 const lookup=()=>models.map(m=>runtime.getModel(m.provider,m.id));
 const registeredGetModel=runtime.getModel.bind(runtime);
 runtime.getModel=(provider,id)=>models.some(m=>m.provider===provider&&m.id===id)?registeredGetModel(provider,id):undefined;
 runtime.getModels=provider=>lookup().filter(m=>!provider||m.provider===provider);
 runtime.getAvailableSnapshot=()=>lookup();runtime.getAvailable=async provider=>runtime.getModels(provider);
 runtime.streamSimple=(model,context,options)=>proxyStream(ai,config,grant,model,context,options);
 runtime.stream=runtime.streamSimple;
 for(const method of ['classify','generateImages','streamDeferred','fetchDeferred','cancelDeferred'])runtime[method]=()=>{throw Error('Gateway operation is unsupported; direct-provider fallback forbidden');};
 return {runtime,grant,models};
}
export function sessionAudit(directory,identity){
 const audit=createAudit(join(directory,'usage-audit.jsonl'));
 audit.append({type:'session-start',...identity,routing:'direct-audited',confinement:'unverified'});
 return {audit,message:message=>audit.append({type:'usage',...identity,provider:message.provider??null,model:message.model??null,requestId:message.gatewayRequestId??null,usage:usageMetadata(message.usage),decision:['error','aborted'].includes(message.stopReason)?'incomplete':'observed',routing:'direct-audited',confinement:'unverified'})};
}
