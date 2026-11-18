import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {killGroup,launch} from './context.mjs';
import {choice,str,uint,tool} from './schema.mjs';
import {unseal} from '../experiment.mjs';
const history=new Map();
let active;
const shard={type:'string',pattern:'^[0-9]{1,9}/[1-9][0-9]{0,8}$'};
function options(a){
  if(a.shard){const [i,n]=a.shard.split('/').map(Number);if(i>=n)throw Error('shard index must be below total')}
  return [...(a.until!==undefined?['--until',String(a.until)]:[]),...(a.shard?['--shard',a.shard]:[])];
}
function snapshot(j){return {jobId:j.id,operation:j.operation,status:j.state,output:j.rel,exitCode:j.code,signal:j.signal,lastStderr:j.stderr,progress:j.progress??null}}
function job(id){const j=history.get(id);if(!j)throw Error('unknown job');return j}
function tree(dir,ctx){
 let count=0;const visit=p=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){if(++count>200000)throw Error('too many files');if(e.isDirectory())visit(path.join(p,e.name));else if(!e.isFile())throw Error('links and special files are not permitted')}};visit(ctx.input(dir));
}
function start(op,a,c){
 if(active)throw Error('another background job is active');
 const script=f=>path.join(c.repo,f);let exe=process.execPath,argv,dir,existing=false;
 if(op==='start_run'){const plan=c.input(a.plan);dir=c.output(a.out);argv=[script('mcp/train.mjs'),c.root,plan,dir,...options(a)]}
 else if(op==='resume_run'||op==='rerun'||op==='start_assessment'){
   const run=c.archive(a.run);exe=c.nodeFor(run);
   if(op==='resume_run'){existing=true;dir=run;argv=[path.join(run,'code/experiment.mjs'),'resume',run,...options(a)]}
   else if(op==='rerun'){dir=c.output(a.out);argv=[path.join(run,'code/experiment.mjs'),'rerun',run,dir,...options(a)]}
   else{dir=c.output(a.out);argv=[script('experiment.mjs'),'assess',run,c.input(a.spec),dir]}
 }else{
   dir=c.output(a.out);const spec=c.input(a.spec);
   const expected={collect:['run'],fit:['dataset'],score:['run','dataset','models']}[a.step];
   for(const k of ['run','dataset','models'])if(expected.includes(k)!==(a[k]!==undefined))throw Error('invalid '+a.step+' inputs: expected '+expected.join(', '));
   const parts=[];for(const k of expected){
     if(k==='run'){const r=c.archive(a.run);exe=c.nodeFor(r);parts.push(r)}
     else{const d=c.input(a[k]);tree(d,c);if(k==='models'){
       const m=unseal(c.input(path.join(d,'fit.json'))).body;
       if(!Object.hasOwn(m.toolchain.hashes,'fitter.mjs')||Object.keys(m.toolchain.hashes).some(s=>!/^[-\w]+\.(mjs|bend)$/.test(s))||m.spec.arms.some(x=>!/^[-\w]+$/.test(x.id)))throw Error('invalid fitted archive');
     }parts.push(d)}
   }argv=[script('batch.mjs'),a.step,...parts,spec,dir];
 }
 if(!existing)fs.mkdirSync(dir,{mode:0o700});
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bend-mcp-job-'));
 let child;try{child=launch(exe,argv,{cwd:c.repo,env:{...process.env,TMPDIR:tmp,TMP:tmp,TEMP:tmp,BEND_NO_TELEMETRY:'1'}})}catch(e){fs.rmSync(tmp,{recursive:true,force:true});throw e}
 const j={id:randomUUID(),operation:op,dir,rel:path.relative(c.root,dir),state:'running',stderr:'',code:null,signal:null,child};
 active=j;history.set(j.id,j);if(history.size>128)history.delete(history.keys().next().value);
 child.stdout.resume();child.stderr.on('data',b=>{j.stderr=(j.stderr+b.toString()).slice(-4096)});
 child.on('error',e=>{j.stderr=e.message});
 j.done=new Promise(resolve=>child.once('close',(code,signal)=>{
   j.code=code;j.signal=signal;j.state=j.state==='cancelling'?'cancelled':code===0?'completed':'failed';active=null;fs.rmSync(tmp,{recursive:true,force:true});resolve();
 }));
 return snapshot(j);
}
const make=(n,d,p,r)=>tool(d,p,r,false,(a,c)=>start(n,a,c));
export const jobs={
 start_run:make('start_run','Start training in a new directory. Optional shard uses zero-based I/N.',{plan:str,out:str,until:uint,shard},['plan','out']),
 resume_run:make('resume_run','Resume a trusted archive in place with its recorded Node runtime.',{run:str,until:uint,shard},['run']),
 rerun:make('rerun','Reproduce a trusted archived run in a fresh directory.',{run:str,out:str,until:uint,shard},['run','out']),
 start_assessment:make('start_assessment','Run an assessment against a trusted run in a fresh directory.',{run:str,spec:str,out:str},['run','spec','out']),
 start_offline:make('start_offline','Collect requires run; fit requires dataset; score requires run, dataset and models. Each writes a new directory.',{step:choice('collect','fit','score'),spec:str,out:str,run:str,dataset:str,models:str},['step','spec','out']),
 job_status:tool('Show background process state and checkpoint progress (whole experiment, including other shards).',{jobId:str},['jobId'],true,async(a,c)=>{
   const j=job(a.jobId);
   if(['start_run','resume_run','rerun'].includes(j.operation)&&fs.existsSync(path.join(j.dir,'run.json'))){
     try{const d=c.archive(j.dir);j.progress=JSON.parse(await c.exec(process.execPath,[path.join(c.repo,'experiment.mjs'),'status',d],{cwd:c.repo,timeout:3000,maxBytes:8192}))}catch(e){j.progress={unavailable:e.message}}
   }
   return snapshot(j);
 }),
 cancel_job:tool('Terminate a job and its process group; wait for exit before releasing the slot.',{jobId:str},['jobId'],false,async a=>{
   const j=job(a.jobId);if(j.state==='running'){killGroup(j.child);j.state='cancelling'}await j.done;return snapshot(j);
 }),
 select_confirmation:tool('Select confirmation arms from a completed screening run into a new directory.',{run:str,spec:str,out:str},['run','spec','out'],false,async(a,c)=>{
   const r=c.archive(a.run),s=c.input(a.spec),d=c.output(a.out);fs.mkdirSync(d,{mode:0o700});
   await c.exec(process.execPath,[path.join(c.repo,'experiment.mjs'),'select',r,s,d],{timeout:15000});
   return {selection:unseal(path.join(d,'selection.json')).body,plan:JSON.parse(fs.readFileSync(path.join(d,'plan.json')))};
 })
};
