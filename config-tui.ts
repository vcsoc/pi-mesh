import {Editor,Key,matchesKey,parseColor,truncateToWidth,visibleWidth} from '@earendil-works/pi-tui';
import {readProjectConfig,saveProjectConfig,validateProjectConfig} from './project-config.mjs';
import {canonicalProject} from './fleet.mjs';

// Project settings only. Broker credentials and already-approved runs are never edited.
export async function editProjectConfig(ctx:any){
 if(ctx.mode!=='tui'||!ctx.hasUI)throw Error('/mesh config requires interactive Pi TUI mode');
 const project=canonicalProject(ctx.cwd),snapshot=readProjectConfig(project);
 return ctx.ui.custom((tui:any,theme:any,_keys:any,done:any)=>{
  let focus=0,error='',finished=false;
  const editor=new Editor(tui,{borderColor:(s:string)=>theme.fg('accent',s),selectList:{selectedPrefix:(s:string)=>s,selectedText:(s:string)=>s,description:(s:string)=>s,scrollInfo:(s:string)=>s,noMatch:(s:string)=>s}});
  editor.setText(snapshot.text);editor.disableSubmit=true;editor.focused=true;
  const finish=(value:any)=>{if(!finished){finished=true;done(value)}};
  const save=()=>{try{const text=editor.getExpandedText();validateProjectConfig(JSON.parse(text));const saved=saveProjectConfig(project,text,snapshot.revision);finish(saved.path)}catch(cause:any){error=cause.message}};
  return{
   get focused(){return editor.focused},set focused(value:boolean){editor.focused=value&&focus===0},
   render(width:number){
    const inner=Math.max(0,width-2),border=(s:string)=>theme.style(s,{fg:parseColor('#5b9dff')}),line=(s:string)=>{const clipped=truncateToWidth(s,inner);return border('│')+clipped+' '.repeat(Math.max(0,inner-visibleWidth(clipped)))+border('│')};
    const actions=['Cancel','Save'].map((label,index)=>theme.style(focus===index+1?`[ ${label} ]`:`  ${label}  `,{fg:parseColor(index?'#65ce8a':'#e5b84b'),bold:focus===index+1})).join('  ');
    return[border('╭'+'─'.repeat(inner)+'╮'),line(theme.fg('accent',' MESH PROJECT CONFIG')),line(snapshot.path),...editor.render(Math.max(1,inner)).map(line),line(error?theme.fg('error',error):'New approvals use these settings; running grants stay unchanged.'),line(actions),line('Tab: editor / Cancel / Save · Enter: choose · Esc: Cancel'),border('╰'+'─'.repeat(inner)+'╯')].map(s=>truncateToWidth(s,width));
   },
   invalidate(){editor.invalidate()},
   handleInput(data:string){
    if(matchesKey(data,Key.escape))return finish(undefined);
    if(matchesKey(data,Key.tab)||matchesKey(data,Key.shift('tab'))){focus=(focus+(matchesKey(data,Key.tab)?1:2))%3;editor.focused=focus===0}
    else if(focus&&matchesKey(data,Key.enter)){if(focus===1)finish(undefined);else save()}
    else if(focus&&(matchesKey(data,Key.left)||matchesKey(data,Key.right))){focus=focus===1?2:1}
    else if(!focus)editor.handleInput(data);
    tui.requestRender();
   },
  };
 });
}
