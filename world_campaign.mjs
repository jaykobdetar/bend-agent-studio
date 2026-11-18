// Differentially check generated Bend worlds against an independent simulator.
// Each batch compiles fresh worlds. A failing batch is reproducible by seed.
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {bendSource,worldDefinition} from './finite_world.mjs';

const exec=promisify(execFile), here=path.dirname(fileURLToPath(import.meta.url));
const modulus=1n<<32n;
function mix(w) {
  w=Math.imul(w^(w>>>16),2246822507);
  w=Math.imul(w^(w>>>13),3266489909);
  return (w^(w>>>16))>>>0;
}
function next(w) {return (Math.imul(w,1664525)+1013904223)>>>0;}
function generator(seed) {
  let value=seed>>>0;
  return ()=>{value=(value+0x9e3779b9)>>>0;return mix(value);};
}
function pick(xs,word) {
  const total=xs.reduce((n,x)=>n+BigInt(x.weight),0n);
  const target=(BigInt(word)+1n)*total;
  let cum=0n;
  for (const x of xs) {
    cum+=BigInt(x.weight);
    if (cum*modulus>=target) return x;
  }
  throw Error('reference distribution did not cover its word');
}
function wordsAtEdges(xs,rand) {
  const sum=xs.reduce((n,x)=>n+BigInt(x.weight),0n);
  const words=new Set([0,1,0x7fffffff,0x80000000,0xfffffffe,0xffffffff,rand(),rand()]);
  let acc=0n;
  for (const x of xs) {
    acc+=BigInt(x.weight);
    const b=Number(acc*modulus/sum);
    if (b>0) words.add(b-1);
    if (b<2**32) words.add(b);
  }
  return words;
}
const rewardPool=[0,-0,1,-1,0.125,-0.25,1.5,-13.75,2**-20,2**-35,2**18,1e21,-1e21];
function makeWorld(rand) {
  const length=2+rand()%7;
  const ids=new Set([0,0xffffffff]);
  while(ids.size<length) ids.add(rand());
  const all=[...ids];
  const state=()=>all[rand()%all.length];
  const weights=(n)=> {
    if (n===2 && rand()%5===0) return [1,0xffffffff];
    return Array.from({length:n},()=>1+rand()%10000000);
  };
  const states=all.map((id,i)=>{
    const count=rand()%4;
    const aids=new Set();
    if (count && rand()%3===0) aids.add(0xffffffff);
    while(aids.size<count) aids.add(rand()%2?rand():rand()%50);
    return {id,observation:rand()%2?rand()%3:id,actions:[...aids].map(a=>{
      const ws=weights(1+rand()%4);
      return {id:a,outcomes:ws.map(weight=>({to:state(),weight,reward:rewardPool[rand()%rewardPool.length]}))};
    })};
  });
  const ws=weights(1+rand()%3);
  return {schema:1,initial:ws.map(weight=>({to:state(),weight})),states};
}
const floatBits=new DataView(new ArrayBuffer(4));
function bits(x) {floatBits.setFloat32(0,x,true);return floatBits.getUint32(0,true);}
function refEpisode(world,seed,limit,train) {
  const nodes=new Map(world.states.map(s=>[s.id,s]));
  let state=nodes.get(pick(world.initial,mix(seed^3266489917)).to);
  let model=17, score=0, word=next(seed), steps=0;
  while (state.actions.length && steps<limit) {
    const pw=mix(word^1515870810), ww=mix(next(word)^2779096485);
    const id=(pw&63)===0?0xffffffff:state.actions[pw%state.actions.length].id;
    const action=state.actions.find(a=>a.id===id);
    if (!action) return {model,score,steps,reason:{$:'Illegal',action:id}};
    const hit=pick(action.outcomes,ww), after=nodes.get(hit.to);
    steps++;
    const flags=after.actions.length?(steps===limit?2:0):1;
    if (train) model=mix((model^state.observation^id^bits(hit.reward)^after.observation^flags)>>>0);
    score=Math.fround(score+hit.reward);
    state=after;word=next(next(word));
  }
  return {model,score,steps,reason:{$:state.actions.length?'Limit':'Terminal'}};
}
const probe=`import Base
import ./engine.bend as E
import ./tabular.bend as T

def pick(reject: Bool, actions: List<&2,U32>, word: U32) -> U32:
  match reject:
    case True{}: 4294967295
    case False{}: T.random_action(actions,word)

def act(model: U32, obs: U32, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  +w = word
  pick(U32.is_eq(U32.and(w,63),0),actions,w)

def learn(model: U32, event: E.Transition<U32>) -> U32:
  match event:
    case E.Transition{obs,action,r,E.End{after},cut}:
      E.mix_word(U32.xor(U32.xor(U32.xor(model,obs),U32.xor(action,F32.bits(r))),U32.xor(after,1)))
    case E.Transition{obs,action,r,E.Open{after,acts},cut}:
      flags=Bool.pick(U32,cut,2,0)
      E.mix_word(U32.xor(U32.xor(U32.xor(model,obs),U32.xor(action,F32.bits(r))),U32.xor(after,flags)))
`;

function source(n) {
  let root='import Base\nimport ./engine.bend as E\nimport ./cursor.bend as C\nimport ./probe.bend as P\n';
  for (let i=0;i<n;i++) root+='import ./w'+i+'.bend as W'+i+'\n';
  for (let i=0;i<n;i++) {
    const hooks='~U32,~U32,~U32,~E.Hooks{W'+i+'.world(),P.act,P.learn}';
    root+='\ndef ep'+i+'(seed: U32, limit: Nat, mode: E.Mode) -> E.Report<U32>:\n'+
      '  E.episode('+hooks+',mode,17,seed,limit)\n'+
      '\ndef slice'+i+'(seed: U32, +limit: Nat, cut: Nat, +mode: E.Mode) -> Maybe<&2,E.Report<U32>>:\n'+
      '  cursor=C.start('+hooks+',17,seed,limit)\n'+
      '  partial=C.advance('+hooks+',cut,mode,cursor)\n'+
      '  C.finished(U32,U32,U32,C.advance('+hooks+',limit,mode,partial))\n';
  }
  return root;
}
function array(list) {
  const result=[];for(;list.$==='Con';list=list.tail)result.push(list.head);
  assert.equal(list.$,'Nil');return result;
}

async function batch(dir,bend,id,worldCount,checks) {
  const rand=generator(id), worlds=Array.from({length:worldCount},()=>makeWorld(rand));
  for (const [i,w] of worlds.entries()) fs.writeFileSync(path.join(dir,'w'+i+'.bend'),bendSource(worldDefinition(w)));
  fs.writeFileSync(path.join(dir,'campaign.bend'),source(worldCount));
  const module=path.join(dir,'compiled.mjs');
  await exec(bend,[path.join(dir,'campaign.bend'),'-o',module],{env:{...process.env,BEND_NO_TELEMETRY:'1'}});
  const api=(await import(pathToFileURL(module).href+'?batch='+id)).default;
  let transitions=0,episodes=0;
  for (const [i,w] of worlds.entries()) {
    const tag='w'+i+':', game=worldDefinition(w);
    for (const s of game.states) {
      const v=api[tag+'view'](s.id);
      assert.equal(v.observation,s.observation);
      assert.equal(v.$,s.actions.length?'Open':'End');
      if (s.actions.length) assert.deepEqual(array(v.actions),s.actions.map(a=>a.id));
      for (const a of s.actions) for (const word of wordsAtEdges(a.outcomes,rand)) {
        const got=api[tag+'step'](s.id,a.id,word), ref=pick(a.outcomes,word);
        assert.equal(got.fst,ref.to);assert.equal(bits(got.snd),bits(ref.reward));
        transitions++;
      }
    }
    for (let j=0;j<checks;j++) {
      const seed=rand(),limit=rand()%24, cut=rand()%(limit+2);
      const mode={$:j%2?'Train':'Evaluate'};
      const initial=pick(game.initial,mix(seed^3266489917));
      assert.equal(api[tag+'reset'](seed),initial.to);
      const {model,score,steps,reason}=api['ep'+i](seed,limit,mode);
      const report={model,score,steps,reason};
      assert.deepEqual(report,refEpisode(game,seed,limit,j%2));
      assert.deepEqual(api['slice'+i](seed,limit,cut,mode).value,{$:'Report',...report});
      episodes++;
    }
  }
  return {id,worlds:worldCount,transitions,episodes};
}

async function isolatedBatch(dir,bend,id,worlds,episodes) {
  const worker=new Worker(pathToFileURL(path.join(dir,'world_campaign.mjs')),{workerData:{dir,bend,id,worlds,episodes}});
  return new Promise((resolve,reject)=>{
    let result;
    worker.once('message',message=>{result=message;});
    worker.once('error',reject);
    worker.once('exit',code=>code===0&&result?resolve(result):reject(Error('batch worker exited '+code)));
  });
}

async function campaign() {
const args=process.argv.slice(2);
const config={bend:process.env.BEND??'bend',seed:1,batches:1,worlds:3,episodes:64,until:null};
for (let i=0;i<args.length;i+=2) {
  const key=args[i]?.slice(2), value=args[i+1];
  if (!Object.hasOwn(config,key)||value===undefined) throw Error('usage: [--bend PATH] [--seed N] [--batches N] [--worlds N] [--episodes N]');
  config[key]=key==='bend'?value:key==='until'?Date.parse(value):Number(value);
}
for (const k of ['seed','batches','worlds','episodes']) if (!Number.isSafeInteger(config[k]) || config[k]<(k==='seed'?0:1)) throw Error('invalid '+k);
if (config.until!==null && (!Number.isFinite(config.until)||config.until<=Date.now())) throw Error('until must be a future ISO timestamp');
if (config.until!==null && !args.includes('--batches')) config.batches=Infinity;
const totals={batches:0,worlds:0,transitions:0,episodes:0};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bend-world-check-'));
let current=config.seed;
try {
  const hashes={};
  for (const name of ['engine.bend','cursor.bend','tabular.bend','finite.bend','history.bend','finite_world.mjs','world_campaign.mjs']) {
    const data=fs.readFileSync(path.join(here,name));hashes[name]=createHash('sha256').update(data).digest('hex');
    fs.writeFileSync(path.join(dir,name),data);
  }
  fs.writeFileSync(path.join(dir,'probe.bend'),probe);
  console.log(JSON.stringify({type:'start',seed:current,hashes,compiler:(await exec(config.bend,['version'])).stdout.trim()}));
  for (let b=0;b<config.batches && (config.until===null || Date.now()<config.until);b++) {
    current=(config.seed+b)>>>0;
    const result=await isolatedBatch(dir,config.bend,current,config.worlds,config.episodes);
    totals.batches++; for (const k of ['worlds','transitions','episodes']) totals[k]+=result[k];
    console.log(JSON.stringify({type:'batch',...result}));
  }
  console.log(JSON.stringify({type:'summary',...totals}));
} catch(e) {
  console.error('Failing batch seed '+current+': '+(e.stack??e));process.exitCode=1;
} finally {fs.rmSync(dir,{recursive:true,force:true});}
}

if (isMainThread) await campaign();
else {
  const {dir,bend,id,worlds,episodes}=workerData;
  parentPort.postMessage(await batch(dir,bend,id,worlds,episodes));
}
