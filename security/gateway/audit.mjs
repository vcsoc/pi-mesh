import {openSync,closeSync,readFileSync,fstatSync,writeSync,fsyncSync,mkdirSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
export function readPrivateJSON(file,{maxBytes=2*1024*1024}={}){
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const st=fstatSync(fd);if(!st.isFile()||(st.mode&0o077)||st.nlink!==1||st.uid!==process.getuid?.()||st.size>maxBytes)throw Error('Unsafe private JSON file');
  try{return JSON.parse(readFileSync(fd,'utf8'));}catch{throw Error('Invalid private JSON file');}
 }finally{closeSync(fd);}
}
const fields=new Set(['type','product','sessionId','agentId','runId','project','requestId','provider','model','actualProvider','actualModel','policyRevision','decision','code','usage','routing','confinement','expiresAt','operation']);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function hasReportedUsage(data){
 const candidates=[data?.usage,data?.message?.usage,data?.response?.usage,data?.usageMetadata,data?.metadata?.usage];
 const counts=new Set(['input_tokens','output_tokens','prompt_tokens','completion_tokens','total_tokens','inputTokens','outputTokens','totalTokens','promptTokenCount','candidatesTokenCount','totalTokenCount']);
 return candidates.some(u=>u&&typeof u==='object'&&u.unknown!==true&&Object.entries(u).some(([k,v])=>counts.has(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0));
}
export function providerUsageSnapshot(data){
 const candidates=[data?.usage,data?.message?.usage,data?.response?.usage,data?.usageMetadata,data?.metadata?.usage];
 const u=candidates.find(u=>hasReportedUsage({usage:u}));if(!u)return null;
 return {...usageMetadata({reported:true,input:u.input_tokens??u.prompt_tokens??u.inputTokens??u.promptTokenCount,output:u.output_tokens??u.completion_tokens??u.outputTokens??u.candidatesTokenCount,cacheRead:u.cache_read_input_tokens??u.prompt_tokens_details?.cached_tokens??u.input_tokens_details?.cached_tokens??u.cachedContentTokenCount,cacheWrite:u.cache_creation_input_tokens,totalTokens:u.total_tokens??u.totalTokens??u.totalTokenCount}),provenance:'provider-snapshot'};
}
export function usageMetadata(usage){
 const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
 const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
 let u=usage&&typeof usage==='object'&&usage.unknown!==true?usage:{};
 // SDKs commonly normalize an absent provider usage block to all zeros.
 // Conservatively label those values unknown unless explicitly observed.
 if(u.reported!==true&&![u.input,u.output,u.cacheRead,u.cacheWrite,u.totalTokens].some(v=>typeof v==='number'&&v>0))u={};
 const input=count(u.input),output=count(u.output),cacheRead=count(u.cacheRead),cacheWrite=count(u.cacheWrite);
 const components=[input,output,cacheRead,cacheWrite];
 const total=count(u.totalTokens)??(components.every(x=>x!==null)?count(components.reduce((a,b)=>a+b,0)):null);
 return {input,output,cacheRead,cacheWrite,total,cost:number(u.cost?.total),provenance:'sdk-normalized',complete:components.every(x=>x!==null)&&total!==null};
}
export function createAudit(file,{clock=()=>Date.now(),maxBytes=64*1024*1024}={}){
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const parent=lstatSync(dirname(file));if(parent.isSymbolicLink()||!parent.isDirectory()||(parent.mode&0o077))throw Error('Audit directory must be private and not a symlink');
 let previous='0'.repeat(64),sequence=0,inode,size;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1024)throw Error('Invalid audit size policy');
 const fd=openSync(file,constants.O_CREAT|constants.O_APPEND|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
 try{
  const info=fstatSync(fd);if(!info.isFile()||(info.mode&0o077)||info.nlink!==1||info.uid!==process.getuid?.())throw Error('Unsafe audit file');
  if(info.size>maxBytes)throw Error('Audit capacity exhausted; archive through approved retention workflow');
  inode=info.ino;size=info.size;
  const text=readFileSync(fd,'utf8');
  for(const line of text.split('\n').filter(Boolean)){
   const record=JSON.parse(line),{digest,...payload}=record;
   if(payload.previous!==previous||payload.sequence!==sequence+1||hash(payload)!==digest)throw Error('Audit chain is corrupt');
   previous=digest;sequence=payload.sequence;
  }
 }finally{closeSync(fd);}
 let busy=false;
 const append=metadata=>{
  if(busy)throw Error('Concurrent audit write');busy=true;
  let descriptor;
  try{
   if(!metadata||typeof metadata!=='object'||!metadata.type)throw Error('Audit event type required');
   for(const [key,value] of Object.entries(metadata)){
    if(!fields.has(key))throw Error('Audit metadata field not allowed');
    if(key==='usage'){
     const allowed=new Set(['input','output','cacheRead','cacheWrite','total','cost','provenance','complete']);
     if(!value||typeof value!=='object'||Object.keys(value).some(k=>!allowed.has(k))||typeof value.complete!=='boolean'||!['sdk-normalized','executor-reported','client-reported-sdk-normalized','provider-snapshot'].includes(value.provenance))throw Error('Invalid usage metadata');
     for(const [k,v] of Object.entries(value))if(!['provenance','complete'].includes(k)&&v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0||k!=='cost'&&!Number.isSafeInteger(v)))throw Error('Invalid audit usage');
    }else if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw Error('Audit field must be scalar');
    if(typeof value==='string'&&(value.length>1200||/[\x00-\x1f]/.test(value)))throw Error('Invalid audit field');
   }
   descriptor=openSync(file,constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW);
   const st=fstatSync(descriptor);if(!st.isFile()||(st.mode&0o077)||st.nlink!==1||st.uid!==process.getuid?.())throw Error('Unsafe audit file');
   if(st.ino!==inode||st.size!==size)throw Error('Audit file replaced or changed by another writer');
   const record={version:1,sequence:sequence+1,at:new Date(clock()).toISOString(),id:randomUUID(),previous,...metadata};
   const digest=hash(record);const bytes=Buffer.from(JSON.stringify({...record,digest})+'\n');
   if(size+bytes.length>maxBytes)throw Error('Audit capacity exhausted; archive through approved retention workflow');
   let offset=0;while(offset<bytes.length)offset+=writeSync(descriptor,bytes,offset,bytes.length-offset);
   fsyncSync(descriptor);previous=digest;sequence++;size+=bytes.length;return {id:record.id,digest,sequence};
  }finally{if(descriptor!==undefined)closeSync(descriptor);busy=false;}
 };
 return {append,file,get sequence(){return sequence;}};
}
