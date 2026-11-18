// Keep the IPC watchdog responsive even while the real runner is CPU-bound.
// Its group is created by the MCP process; descendants inherit that group.
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
const [program,...args]=process.argv.slice(2);
function orphaned(){
  if(process.platform==='win32'){
    try{execFileSync(path.join(process.env.SystemRoot,'System32','taskkill.exe'),['/PID',String(process.pid),'/T','/F'],{timeout:5000,stdio:'ignore'})}finally{process.exit(1)}
  }else process.kill(-process.pid,'SIGKILL');
}
if(!process.send)throw Error('an IPC owner is required');
process.once('disconnect',orphaned);
const child=spawn(program,args,{stdio:['ignore','inherit','inherit'],windowsHide:true});
child.once('error',e=>{console.error(e.message)});
child.once('close',code=>{process.removeListener('disconnect',orphaned);if(process.connected)process.disconnect();process.exitCode=code??1});
