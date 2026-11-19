// Offline fitting accepts the logged fit partition and the four Bend library
// modules below. No source game or simulator is needed until online scoring.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execute} from './process_output.mjs';
import {canonical,checkSeedBlocks,digest} from './experiment_config.mjs';
import {policyOracle} from './public_oracle.mjs';
import {stepEstimates,fitQEvaluation} from './ope.mjs';
import {existing,adapterName,immutable,json,record,seal,stats,unseal} from './experiment.mjs';
import {actionBuckets,archive,collect,fields,id,openDataset,seedAllocation,uint} from './dataset.mjs';

const bendLibraryDir=path.dirname(fileURLToPath(import.meta.url));
const methods={behavior_cloning:'Clone',fitted_q:'Fitted',supported_fitted_q:'Supported'};
const evaluation={$:'Evaluate'};
function list(xs) {
  let out={$:'Nil'};
  for (let i=xs.length-1;i>=0;i--) out={$:'Con',head:xs[i],tail:out};
  return out;
}
function transition(f) {
  if (!uint(f.observation) || !uint(f.nextObservation)) throw Error('tabular fitting needs discrete U32 observations');
  return {$:'Transition',observation:f.observation,action:f.action,reward:f.reward,truncated:f.truncated,
    next:f.terminal?{$:'End',observation:f.nextObservation}:{$:'Open',observation:f.nextObservation,actions:list(f.nextLegal)}};
}

function fitDesign(spec) {
  fields(spec,['schema','name','arms'],'offline fit');
  if (spec.schema!==1 || !id(spec.name) || !Array.isArray(spec.arms) || !spec.arms.length ||
      new Set(spec.arms.map(a=>a.id)).size!==spec.arms.length) throw Error('invalid offline fit design');
  for (const a of spec.arms) {
    fields(a,['id','method','iterations','gamma'],'offline arm');
    if (!id(a.id) || !Object.hasOwn(methods,a.method)) throw Error('invalid offline fitting method');
    if (a.method==='behavior_cloning') {
      if (a.gamma!==undefined || a.iterations!==undefined) throw Error('behavior cloning uses observed action counts');
    } else if (!uint(a.iterations) || !a.iterations || !Number.isFinite(a.gamma) || a.gamma<0 || a.gamma>1) {
      throw Error('fitted Q needs positive iterations and gamma in [0,1]');
    }
  }
  return spec;
}

async function compiler(bend, output) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bend-offline-'));
  const env={...process.env,BEND_NO_TELEMETRY:'1'};
  try {
    const hashes={};
    for (const name of ['offline.bend','engine.bend','tabular.bend','dyna.bend']) {
      const bytes=fs.readFileSync(path.join(bendLibraryDir,name));
      fs.writeFileSync(path.join(temp,name),bytes);
      hashes[name]=digest(bytes);
    }
    const version=(await execute(bend,['version'],{env})).stdout.trim();
    await execute(bend,[path.join(temp,'offline.bend'),'-o',path.join(temp,'fitter.mjs')],{env});
    hashes['fitter.mjs']=digest(fs.readFileSync(path.join(temp,'fitter.mjs')));
    for (const name of Object.keys(hashes)) immutable(path.join(output,'code',name),fs.readFileSync(path.join(temp,name)));
    return {bend:version,node:process.versions.node,hashes};
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
}

async function fit(data,config,output,bend) {
  const d=openDataset(data), spec=fitDesign(json(config));
  if (d.design.observationDomain!=='discrete') throw Error('offline table methods require discrete observations');
  const toolchain=await compiler(bend,output);
  const manifest=seal({dataset:d.index.hash,spec,toolchain});
  immutable(path.join(output,'fit.json'),manifest);
  const api=(await import(pathToFileURL(path.join(output,'code','fitter.mjs')).href)).default;
  for (let rep=0;rep<d.design.replicates;rep++) {
    let batch=api.empty(), steps=0;
    const seen=new Map();
    for (const ep of d.episodes('fit',rep)) for (const f of ep.frames) {
      const actions=seen.get(f.observation)??new Set();
      actions.add(f.action);seen.set(f.observation,actions);
      batch=api.observe(batch,transition(f));steps++;
    }
    for (const a of spec.arms) {
      const model=api.fit({$:methods[a.method]},batch,a.iterations??0,Math.fround(a.gamma??0));
      const body={fit:JSON.parse(manifest).hash,arm:a.id,rep,steps,observations:seen.size,
        observedPairs:[...seen.values()].reduce((n,actions)=>n+actions.size,0),model};
      immutable(path.join(output,'models',a.id,rep+'.json'),seal(body));
    }
  }
  console.log(spec.name+': '+d.design.replicates*spec.arms.length+' policies fitted from the fit partition.');
}

// Undiscounted trajectory importance sampling for a deterministic target.
// Accumulating in log space keeps ESS and normalized estimates finite.
export function offPolicy(episodes, action, buckets) {
  const matched=[];
  let unsupported=0;
  for (const ep of episodes) {
    let logWeight=0, follows=true;
    for (const f of ep.frames) {
      if (!follows) break;
      const target=action(f.observation,f.legal), i=f.legal.indexOf(target);
      if (i<0) throw Error('target policy proposed an illegal action in logged data');
      if (!actionBuckets(f.legal,f.preferred,buckets)[i]) unsupported++;
      if (f.action!==target) follows=false;
      else logWeight-=Math.log(f.propensityBuckets/65536);
    }
    if (follows) matched.push({logWeight,score:ep.score});
  }
  const info={episodes:episodes.length,matched:matched.length,unsupported,ess:0,ordinary:null,normalized:null};
  if (unsupported || !matched.length) return info;
  const max=matched.reduce((m,row)=>Math.max(m,row.logWeight),-Infinity);
  let sum=0,squares=0,reward=0;
  for (const row of matched) {
    const w=Math.exp(row.logWeight-max);
    sum+=w;squares+=w*w;reward+=w*row.score;
  }
  info.ess=sum*sum/squares;
  info.normalized=reward/sum;
  const ordinary=reward===0?0:Math.sign(reward)*Math.exp(Math.log(Math.abs(reward))+max-Math.log(episodes.length));
  info.ordinary=Number.isFinite(ordinary)?ordinary:null;
  return info;
}

async function score(root, data, fitted, config, output) {
  const d=openDataset(data), f=unseal(path.join(fitted,'fit.json')), design=f.body;
  const {api,manifest,plan}=await archive(root);
  if (d.design.sourceRun!==manifest.hash || design.dataset!==d.index.hash) throw Error('source, dataset and fitted policy lineage differ');
  if (design.toolchain.node!==process.versions.node) throw Error('scoring requires Node '+design.toolchain.node);
  for (const [name,hash] of Object.entries(design.toolchain.hashes)) {
    if (digest(fs.readFileSync(path.join(fitted,'code',name)))!==hash) throw Error('fitting backend checksum mismatch');
  }
  const fitter=(await import(pathToFileURL(path.join(fitted,'code','fitter.mjs')).href)).default;
  const spec=json(config), source=d.design.spec;
  fields(spec,['schema','name','episodes','seeds'],'offline score');
  fields(spec.seeds,['start','stride'],'score seeds');
  if (spec.schema!==1 || !id(spec.name)) throw Error('invalid scoring design');
  checkSeedBlocks([plan,...['fit','holdout'].map(k=>seedAllocation(plan.replicates,source.seeds[k],source.seeds.stride,source[k+'Episodes'])),
    seedAllocation(plan.replicates,spec.seeds.start,spec.seeds.stride,spec.episodes)]);
  const game=plan.games.find(g=>g.id===source.game), logger=plan.arms.find(a=>a.id===source.arm);
  const play=api['offline_'+adapterName(game,logger)];
  if (!play) throw Error('saved simulator lacks a discrete offline-policy evaluation entry point');
  const identity=JSON.parse(seal({dataset:d.index.hash,fit:f.hash,spec,source:manifest.hash}));
  immutable(path.join(output,'score.json'),canonical(identity)+'\n');
  const keys=['game','arm','replicate','train_transitions','observed_pairs','seed','episodes','sum','steps','terminal','limited','illegal',
    'holdout_episodes','matched','unsupported','ess','ordinary','normalized'];
  const estimators=['ordinary','normalized','pdis','weighted_pdis','fqe','doubly_robust'];
  keys.push(...estimators.slice(2),'exact_value','coverage_complete',...estimators.map(k=>k+'_error'));
  const lines=[keys.join(',')];
  for (let rep=0;rep<plan.replicates;rep++) {
    const heldout=d.episodes('holdout',rep), first=spec.seeds.start+rep*spec.seeds.stride;
    const training=d.episodes('fit',rep),buckets=Math.round(source.epsilon*65536);
    let loggerModel,previous=null;
    if(game.definition)for(const n of plan.checkpoints){
      const cp=existing(root,manifest.hash,{game,arm:logger,rep},n,previous);
      if(!cp)throw Error('missing logger checkpoint');
      previous=cp.hash;loggerModel=cp.body.model;if(n===source.checkpoint)break;
    }
    for (const a of design.spec.arms) {
      const policy=unseal(path.join(fitted,'models',a.id,rep+'.json'));
      if (policy.body.fit!==f.hash || policy.body.arm!==a.id || policy.body.rep!==rep) throw Error('fitted policy identity mismatch');
      const model=policy.body.model, online=stats();
      const act=(s,legal)=>fitter.act(model,s,list(legal),evaluation,0);
      const estimate=offPolicy(heldout,act,buckets),extra=stepEstimates(heldout,act,buckets,fitQEvaluation(training,act));
      const preferred=api['preferred_'+adapterName(game,logger)];
      const truth=game.definition?policyOracle(game.definition,game.limit,act,{observation:logger.observation??'current',
        behavior:(s,legal)=>actionBuckets(legal,preferred(loggerModel,s,list(legal)),buckets).map(k=>k/65536)}):null;
      if(truth?.overlap.coverageComplete && !estimate.matched)estimate.ordinary=0;
      if(truth&&!truth.overlap.coverageComplete){
        estimate.ordinary=estimate.normalized=extra.pdis=extra.weighted_pdis=extra.doubly_robust=null;
      }

      for (let i=0;i<spec.episodes;i++) record(online,play(model,first+i,game.limit));
      const result={score:identity.hash,model:policy.hash,game:game.id,arm:a.id,replicate:rep,
        train_transitions:policy.body.steps,observed_pairs:policy.body.observedPairs,seed:first,...online,
        holdout_episodes:estimate.episodes,matched:estimate.matched,unsupported:estimate.unsupported,
        ess:estimate.ess,ordinary:estimate.ordinary,normalized:estimate.normalized,...extra,exact_value:truth?.expectedReturn??null,coverage_complete:truth?.overlap.coverageComplete??null};
      for(const k of estimators)result[k+'_error']=truth && result[k]!=null?result[k]-truth.expectedReturn:null;
      immutable(path.join(output,'trials',a.id,rep+'.json'),seal(result));
      lines.push(keys.map(k=>result[k]??'').join(','));
    }
  }
  immutable(path.join(output,'scores.csv'),lines.join('\n')+'\n');
  console.log(spec.name+': '+(lines.length-1)+' paired policy scores.');
}

export async function main(args) {
  const [cmd,...paths]=args;
  if (cmd==='collect' && paths.length===3) return collect(...paths.map(p=>path.resolve(p)));
  if (cmd==='fit' && (paths.length===3 || paths.length===5 && paths[3]==='--bend')) {
    return fit(...paths.slice(0,3).map(p=>path.resolve(p)),paths[4]??process.env.BEND??'bend');
  }
  if (cmd==='score' && paths.length===5) return score(...paths.map(p=>path.resolve(p)));
  if (cmd==='verify' && paths.length===1) {
    const d=openDataset(path.resolve(paths[0]));
    for (let rep=0;rep<d.design.replicates;rep++) for (const split of ['fit','holdout']) d.episodes(split,rep);
    console.log('Verified '+d.index.body.parts.length+' dataset partitions.');return;
  }
  throw Error('usage: node batch.mjs collect RUN SPEC DATASET | fit DATASET SPEC MODELS [--bend PATH] | score RUN DATASET MODELS SPEC RESULTS | verify DATASET');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
