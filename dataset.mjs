import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonical,checkSeedBlocks,digest} from './experiment_config.mjs';
import {adapterName,checkedSnapshot,existing,frameData,immutable,json,manifestPath,seal,unpack,unseal} from './experiment.mjs';

export const uint=x=>Number.isSafeInteger(x) && x>=0 && x<=0xffffffff;
export const id=x=>typeof x==='string' && /^[a-z][a-z0-9_-]{0,79}$/.test(x);

export function fields(x, names, label) {
  if (!x || typeof x!=='object' || Array.isArray(x) || Object.keys(x).some(k=>!names.includes(k))) throw Error('invalid fields in '+label);
}

export function seedAllocation(replicates, start, stride, episodes) {
  if (!uint(start) || !uint(stride) || !stride || !uint(episodes) || !episodes) throw Error('invalid episode seed allocation');
  return {initializesModel:false,replicates,checkpoints:[0],maxTrainEpisodes:0,validationEpisodes:0,testEpisodes:episodes,
    seeds:{train:0,validation:0,test:start,stride}};
}

// The first buckets are exploratory and cycle through the ordered legal list.
export function actionBuckets(legal, preferred, buckets) {
  if (!legal.length || new Set(legal).size!==legal.length || !legal.every(uint) || !legal.includes(preferred)) {
    throw Error('logging requires distinct legal action IDs and a legal preferred action');
  }
  const each=Math.floor(buckets/legal.length), extra=buckets%legal.length;
  return legal.map((a,i)=>each+Number(i<extra)+(a===preferred?65536-buckets:0));
}

export function checkEpisode(ep, spec, seed, horizon) {
  if (ep.seed!==seed || !Array.isArray(ep.frames) || ep.frames.length>horizon || !Number.isFinite(ep.score) ||
      !['Terminal','Limit'].includes(ep.reason)) throw Error('invalid logged episode');
  if (ep.reason==='Limit' && ep.frames.length!==horizon) throw Error('logged truncation before the horizon');
  const buckets=Math.round(spec.epsilon*65536);
  let sum=0, previous=null;
  for (const [index,f] of ep.frames.entries()) {
    const last=index===ep.frames.length-1;
    if (!f.accepted || !Number.isFinite(f.reward) || f.reward!==Math.fround(f.reward) || !Array.isArray(f.legal) ||
        !Array.isArray(f.nextLegal) || f.terminal!==(last && ep.reason==='Terminal') || f.truncated!==(last && ep.reason==='Limit') ||
        (f.terminal && f.nextLegal.length!==0) || (!f.terminal && !f.nextLegal.length) ||
        (previous && (canonical(previous.nextObservation)!==canonical(f.observation) || canonical(previous.nextLegal)!==canonical(f.legal)))) {
      throw Error('inconsistent logged trajectory at seed '+seed+' frame '+index);
    }
    if (new Set(f.nextLegal).size!==f.nextLegal.length || !f.nextLegal.every(uint)) throw Error('invalid next legal action mask');
    const counts=actionBuckets(f.legal,f.preferred,buckets);
    if (!uint(f.propensityBuckets) || !f.propensityBuckets || f.propensityBuckets!==counts[f.legal.indexOf(f.action)]) {
      throw Error('invalid recorded behavior propensity');
    }
    sum=Math.fround(sum+f.reward);
    previous=f;
  }
  if (sum!==ep.score) throw Error('logged trajectory and total return disagree');
}

function validateCollection(p,spec) {
  fields(spec,['schema','name','game','arm','checkpoint','epsilon','fitEpisodes','holdoutEpisodes','seeds'],'collection');
  fields(spec.seeds,['fit','holdout','stride'],'collection seeds');
  if (spec.schema!==1 || !id(spec.name) || typeof spec.epsilon!=='number' || !Number.isFinite(spec.epsilon) ||
      spec.epsilon<0 || spec.epsilon>1 || !p.checkpoints.includes(spec.checkpoint)) throw Error('invalid collection design');
  const game=p.games.find(g=>g.id===spec.game), arm=p.arms.find(a=>a.id===spec.arm);
  if (!game || !arm) throw Error('unknown logging game or agent');
  const blocks=['fit','holdout'].map(k=>seedAllocation(p.replicates,spec.seeds[k],spec.seeds.stride,spec[k+'Episodes']));
  checkSeedBlocks([p,...blocks]);
  return {game,arm};
}

export async function archive(root) {
  const manifest=unseal(manifestPath(root));
  if (manifest.body.toolchain.node!==process.versions.node) throw Error('recorded run requires Node '+manifest.body.toolchain.node);
  checkedSnapshot(root,manifest);
  const api=(await import(pathToFileURL(path.join(root,'code','backend.mjs')).href)).default;
  return {api,manifest,plan:manifest.body.plan};
}

export async function collect(root, config, output) {
  const {api,manifest,plan}=await archive(root);
  const spec=json(config), {game,arm}=validateCollection(plan,spec), name=adapterName(game,arm);
  const log=api['collect_'+name], base=api['preferred_'+name];
  if (typeof log!=='function' || typeof base!=='function') throw Error('rebuild the source run with logging entry points');
  const buckets=Math.round(spec.epsilon*65536);
  const design=seal({schema:1,sourceRun:manifest.hash,backend:manifest.body.toolchain.backend,spec,replicates:plan.replicates,
    horizon:game.limit,observationDomain:game.domain??(['cartpole','mountain_car'].includes(game.id)?game.id:'discrete'),
    behavior:'fixed evaluation word 0 plus exact 16-bit exploration'});
  immutable(path.join(output,'design.json'),design);
  const parts=[];
  for (let rep=0;rep<plan.replicates;rep++) {
    let parent=null,item;
    for (const n of plan.checkpoints) {
      item=existing(root,manifest.hash,{game,arm,rep},n,parent);
      if (!item) throw Error('missing source checkpoint in collection');
      parent=item.hash;
      if (n===spec.checkpoint) break;
    }
    const model=item.body.model;
    for (const split of ['fit','holdout']) {
      const lines=[], count=spec[split+'Episodes'], first=spec.seeds[split]+rep*spec.seeds.stride;
      let steps=0;
      for (let i=0;i<count;i++) {
        const seed=first+i, replay=log(model,seed,game.limit,buckets);
        if (replay.report.reason.$==='Illegal') throw Error('logging policy chose an illegal action at seed '+seed);
        const frames=unpack(replay.record).map(raw=>{
          const f=frameData(raw);
          f.preferred=base(model,raw.observation,raw.legal);
          f.propensityBuckets=actionBuckets(f.legal,f.preferred,buckets)[f.legal.indexOf(f.action)];
          return f;
        });
        const ep={seed,score:replay.report.score,reason:replay.report.reason.$,frames};
        checkEpisode(ep,spec,seed,game.limit);
        lines.push(canonical(ep));
        steps+=frames.length;
      }
      const bytes=lines.join('\n')+'\n', file=path.join(split,rep+'.jsonl');
      immutable(path.join(output,file),bytes);
      parts.push({split,rep,file,episodes:count,steps,sourceCheckpoint:item.hash,hash:digest(bytes)});
    }
  }
  immutable(path.join(output,'dataset.json'),seal({design:JSON.parse(design).hash,parts}));
  console.log(spec.name+': '+parts.reduce((n,f)=>n+f.episodes,0)+' logged episodes, '+parts.reduce((n,f)=>n+f.steps,0)+' transitions.');
}

export function openDataset(root) {
  const design=unseal(path.join(root,'design.json')), index=unseal(path.join(root,'dataset.json'));
  const d=design.body, spec=d.spec;
  if (index.body.design!==design.hash || index.body.parts.length!==2*d.replicates) throw Error('dataset index differs from design');
  const parts=new Map();
  for (const part of index.body.parts) {
    const key=part.split+'/'+part.rep;
    if (!['fit','holdout'].includes(part.split) || !uint(part.rep) || part.rep>=d.replicates || parts.has(key) ||
        part.episodes!==spec[part.split+'Episodes'] || part.file!==key+'.jsonl') throw Error('invalid dataset partition');
    parts.set(key,part);
  }
  function episodes(split,rep) {
    const part=parts.get(split+'/'+rep), bytes=fs.readFileSync(path.join(root,part.file));
    if (digest(bytes)!==part.hash) throw Error('dataset partition checksum mismatch: '+part.file);
    const lines=bytes.toString().trimEnd().split('\n').map(line=>JSON.parse(line));
    if (lines.length!==part.episodes) throw Error('dataset episode count mismatch');
    const first=spec.seeds[split]+rep*spec.seeds.stride;
    let steps=0;
    for (const [i,ep] of lines.entries()) {checkEpisode(ep,spec,first+i,d.horizon);steps+=ep.frames.length;}
    if (steps!==part.steps) throw Error('dataset transition count mismatch');
    return lines;
  }
  return {design:d,index,episodes};
}
