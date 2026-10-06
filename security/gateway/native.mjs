import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {hasReportedUsage} from './audit.mjs';
const supported=new Set(['anthropic-messages','openai-completions','openai-responses','openai-codex-responses','google-generative-ai','google-vertex','azure-openai-responses','bedrock-converse-stream','mistral-conversations']);
export async function loadAI(sdkPath){
 const paths=createRequire(sdkPath).resolve.paths('@earendil-works/pi-ai');
 const root=paths.map(p=>join(p,'@earendil-works/pi-ai')).find(p=>existsSync(join(p,'package.json')));
 if(!root)throw Error('Cannot locate Pi AI peer');
 const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 return import(pathToFileURL(join(root,manifest.exports?.['.']?.import||manifest.main)).href);
}
export async function createNativeBackend(sdkPath,agentDir){
 const sdk=await import(pathToFileURL(sdkPath).href),ai=await loadAI(sdkPath);
 const runtime=await sdk.ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:join(agentDir,'models.json'),allowModelNetwork:false,refreshOnCreate:false});
 return {
  getModel:(provider,id)=>runtime.getModel(provider,id),
  getModels:()=>runtime.getModels(),
  streamSimple(model,context,options){
   const out=ai.createAssistantMessageEventStream();
   (async()=>{
    let code='UPSTREAM_FAILURE';
    try{
     if(!supported.has(model.api)){code='UNSUPPORTED_API';throw Error(code);}
     const auth=await runtime.getAuth(model,{signal:options.signal});if(!auth){code='AUTH_UNAVAILABLE';throw Error(code);}
     const endpoint=auth.auth.baseUrl||model.baseUrl;
     if(new URL(endpoint).href.replace(/\/$/,'')!==options.approvedEndpoint){code='AUTH_ENDPOINT_DRIFT';throw Error(code);}
     const provider=runtime.getProvider(model.provider);if(!provider)throw Error('Exact provider unavailable');
     const {approvedEndpoint,...safe}=options;
     let reported=false;
     const stream=provider.streamSimple({...model,baseUrl:endpoint},ai.normalizeContext(context),{...safe,apiKey:auth.auth.apiKey,headers:auth.auth.headers,env:auth.env,maxRetries:0,onProviderStreamEvent:data=>{if(hasReportedUsage(data))reported=true;}});
     for await(const event of stream){if(event.type==='done'||event.type==='error'){const message=event.message||event.error;message.usage={...message.usage,reported,unknown:!reported};}out.push(event);}out.end();
    }catch{
     out.push({type:'error',reason:options.signal?.aborted?'aborted':'error',error:{role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,gatewayCode:code,usage:{},stopReason:options.signal?.aborted?'aborted':'error',errorMessage:'Native gateway request failed; authentication, API or endpoint may be unsupported. No fallback or replay.',timestamp:Date.now()}});out.end();
    }
   })();return out;
  },
 };
}
