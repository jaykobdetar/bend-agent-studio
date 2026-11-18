// Some Node/Bun child processes lose piped output in sandboxed runtimes.
// Capture stdout and stderr in regular files and read them after close.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function execute(program,args,options={},onSpawn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bend-process-'));
  const output=path.join(dir,'stdout'), errors=path.join(dir,'stderr');
  const out=fs.openSync(output,'w'), err=fs.openSync(errors,'w');
  try {
    const child=spawn(program,args,{...options,stdio:['ignore',out,err]});
    onSpawn?.(child);
    const status=await new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    const stdout=fs.readFileSync(output,'utf8'), stderr=fs.readFileSync(errors,'utf8');
    if (status.code!==0) throw Error(program+' exited '+(status.signal??status.code)+'\n'+(stderr+'\n'+stdout).trim().slice(-8192));
    return {stdout,stderr};
  } finally {
    fs.closeSync(out);fs.closeSync(err);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
