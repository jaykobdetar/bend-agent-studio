import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {unseal} from '../experiment.mjs';
export const repo=fileURLToPath(new URL('../',import.meta.url));
const children=new Set();

export function killGroup(child) {
  if (!child.pid) return;
  try {
    if (process.platform==='win32') execFileSync(path.join(process.env.SystemRoot,'System32','taskkill.exe'),['/pid',String(child.pid),'/T','/F'],{timeout:5000,stdio:'ignore'});
    else process.kill(-child.pid,'SIGKILL');
  } catch(e) { if (e.code!=='ESRCH' && child.exitCode===null && child.signalCode===null) throw e; }
}
export function shutdown(){for(const c of children)try{killGroup(c)}catch{}}
export function launch(exe,args,opts={}) {
  const c=spawn(process.execPath,[path.join(repo,'mcp/supervisor.mjs'),exe,...args],{cwd:opts.cwd,env:opts.env??process.env,detached:true,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  children.add(c); c.once('close',()=>children.delete(c)); return c;
}
export function exec(exe,args,{cwd,timeout=15000,maxBytes=2**20}={}) {
  return new Promise((resolve,reject)=>{
    const c=launch(exe,args,{cwd}); const chunks=[]; let size=0,err='',failure;
    function stop(reason){if(failure)return;failure=Error(reason);try{killGroup(c)}catch(e){reject(e)}}
    const timer=setTimeout(()=>stop('command timed out'),timeout);
    c.stdout.on('data',b=>{size+=b.length;if(size>maxBytes)stop('command output exceeds size limit');else chunks.push(b)});
    c.stderr.on('data',b=>{err=(err+b.toString()).slice(-4096)});
    c.on('error',e=>{failure=e});
    c.on('close',code=>{clearTimeout(timer);if(failure||code!==0)reject(failure??Error(err.trim()||'command exited '+code));else resolve(Buffer.concat(chunks).toString())});
  });
}
export function context(workspace,nodeMap={}) {
  const root=fs.realpathSync(workspace);
  if(!fs.statSync(root).isDirectory())throw Error('workspace must be a directory');
  function resolve(name,newPath=false) {
    if(typeof name!=='string'||!name||name.includes('\0'))throw Error('invalid path');
    const abs=path.resolve(root,name),rel=path.relative(root,abs);
    if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('path outside workspace');
    let p=root;
    for(const component of rel.split(path.sep).filter(Boolean)) {
      p=path.join(p,component);
      const st=fs.lstatSync(p,{throwIfNoEntry:false});
      if(!st){if(newPath&&p===abs)return abs;throw Error('path does not exist: '+component)}
      if(st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile()))throw Error('links and special files are not permitted');
    }
    if(newPath)throw Error('output already exists');return abs;
  }
  const input=p=>resolve(p),output=p=>resolve(p,true);
  function archive(name){
    const dir=input(name), file=input(path.join(dir,'run.json'));
    if(fs.statSync(file).size>16*2**20)throw Error('manifest too large');
    const m=unseal(file).body, tc=m.toolchain;
    // Self-consistency is not provenance. The owner must control workspace contents.
    if(!tc?.sources||!Object.hasOwn(tc.sources,'experiment.mjs'))throw Error('missing runner fingerprint');
    let snapshotBytes=0;
    if(Object.keys(tc.sources).length>1024)throw Error('too many snapshot files');
    for(const [n,d] of Object.entries({...tc.sources,'backend.mjs':tc.backend})){
      if(!/^[\w.-]+\.(mjs|bend)$/.test(n))throw Error('invalid snapshot path');
      const f=input(path.join(dir,'code',n));const size=fs.statSync(f).size;snapshotBytes+=size;if(size>64*2**20||snapshotBytes>128*2**20)throw Error('snapshot file too large');
      if(createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==d)throw Error('snapshot checksum mismatch: '+n);
    }
    const p=m.plan;
    if(!Number.isInteger(p.replicates)||p.replicates<1||p.replicates>100000||
       !Array.isArray(p.checkpoints)||!p.checkpoints.length||
       p.checkpoints.some((v,i)=>!Number.isInteger(v)||v<0||v>0xffffffff||(i&&v<=p.checkpoints[i-1]))||
       p.games.length*p.arms.length*p.replicates*p.checkpoints.length>200000)
      throw Error('invalid or oversized run dimensions');
    for(const x of [...p.games,...(p.evaluationGames??[]),...p.arms])if(typeof x.id!=='string'||!/^[a-z][a-z0-9_-]{0,79}$/.test(x.id))throw Error('invalid run identifier');
    let count=0;
    function check(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){
      if(++count>200000)throw Error('run exceeds inspection limit');
      if(e.isDirectory())check(path.join(p,e.name));else if(!e.isFile())throw Error('links and special files are not permitted');else if(fs.statSync(path.join(p,e.name)).size>64*2**20)throw Error('run artifact exceeds 64 MiB');
    }}check(dir);
    return dir;
  }
  function nodeFor(dir){
    const v=unseal(input(path.join(dir,'run.json'))).body.toolchain.node;
    if(v===process.versions.node)return process.execPath;
    if(!Object.hasOwn(nodeMap,v)||!path.isAbsolute(nodeMap[v]))throw Error('configure an absolute Node executable for '+v);
    const exe=nodeMap[v];
    if(execFileSync(exe,['--version'],{timeout:3000,encoding:'utf8',maxBuffer:256}).trim()!=='v'+v)throw Error('configured Node does not match '+v);
    return exe;
  }
  return {root,repo,input,output,archive,nodeFor,exec};
}
