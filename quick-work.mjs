const defaultTasks={
 review:'Review the current changes for correctness, security, tests, and unnecessary complexity. Do not modify files. Report specific findings with file references.',
 scout:'Map the relevant code paths, dependencies and risks. Do not modify files.',
};
export function quickWorkRequest(raw){
 const quick=/^(review|scout)(?:\s+([\s\S]*))?$/i.exec(raw.trim());
 if(!quick)return null;
 const kind=quick[1].toLowerCase();
 return {action:'run',definition:{scope:'review',tasks:[{profile:kind==='review'?'reviewer':'scout',task:quick[2]?.trim()||defaultTasks[kind]}]}};
}
