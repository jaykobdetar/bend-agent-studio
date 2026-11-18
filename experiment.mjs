import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execute} from './process_output.mjs';
import {randomUUID} from 'node:crypto';
import {canonical,checkSeedBlocks,digest,games,seedOf,settings,trials,validate} from './experiment_config.mjs';

import {bundleAgent} from './agent_source.mjs';
import {bendSource,floatLiteral,numberPreservingJson,oracle,reactiveOracle,symbol,worldDefinition} from './finite_world.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = filename => JSON.parse(fs.readFileSync(filename,'utf8'));
const manifestPath = root => path.join(root,'run.json');
const train = {$:'Train'}, evaluate = {$:'Evaluate'};

function immutable(filename, bytes) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const tmp = filename+'.'+randomUUID()+'.tmp';
  try {
    fs.writeFileSync(tmp,bytes,{flag:'wx'});
    try { fs.linkSync(tmp,filename); }
    catch (error) {
      if (error.code!=='EEXIST') throw error;
      if (!fs.readFileSync(filename).equals(Buffer.from(bytes))) throw Error('existing output differs: '+filename);
    }
  } finally {
    fs.rmSync(tmp,{force:true});
  }
}

function seal(body) {
  const payload=canonical(body);
  return '{"hash":'+JSON.stringify(digest(payload))+',"body":'+payload+'}\n';
}

function unseal(filename) {
  const item=json(filename);
  if (!item.body || item.hash!==digest(canonical(item.body))) throw Error('checksum mismatch: '+filename);
  return item;
}

function stats() {
  return {episodes:0, steps:0, sum:0, mean:0, m2:0, min:null, max:null, terminal:0, limited:0, illegal:0};
}

function record(s, report) {
  const x=report.score;
  if (!Number.isFinite(x) || !Number.isSafeInteger(report.steps) || report.steps<0) throw Error('invalid Bend episode report');
  s.episodes++;
  s.steps+=report.steps;
  s.sum+=x;
  const delta=x-s.mean;
  s.mean+=delta/s.episodes;
  s.m2+=delta*(x-s.mean);
  s.min=s.min===null?x:Math.min(x,s.min);
  s.max=s.max===null?x:Math.max(x,s.max);
  switch (report.reason.$) {
    case 'Terminal': s.terminal++; break;
    case 'Limit': s.limited++; break;
    case 'Illegal': s.illegal++; break;
    default: throw Error('unknown Bend stop reason '+report.reason.$);
  }
}

function adapterName(game,arm) {
  const base=game.world?'source_'+digest(canonical([game.world.entry,game.parameters,game.domain])).slice(0,24):
    game.definition?symbol(game.definition)+(arm.observation==='previous'?'_history':''):'builtin_'+game.id;
  return base+(arm.method==='custom'?'_'+arm.agent.entry:'');
}

function gameRunner(api,game,arm) {
  const name=adapterName(game,arm);
  const cursor={begin:api['begin_'+name],segment:api['segment_'+name]};
  if (arm.method==='custom') return {...cursor,initial:(p,seed)=>api['initial_'+arm.agent.entry](seed,p),
    episode:api[name],trace:api['trace_'+name]};
  if (game.definition || game.world) {
    const init=game.domain==='mountain_car'?s=>api.car_initial(s):game.domain==='cartpole'?api.pole_initial:api.initial_for;
    return {...cursor,initial:init,episode:api[name],trace:api['trace_'+name]};
  }
  if (game.id==='cartpole') return {...cursor,initial:api.pole_initial,episode:api.pole_episode,trace:api.pole_trace};
  if (game.id==='mountain_car') return {...cursor,initial:s=>api.car_initial(s),episode:api.car_episode,trace:api.car_trace};
  const kind={$:games[game.id]};
  return {...cursor,initial:api.initial_for,episode:(mode,m,seed,limit)=>api.episode(kind,mode,m,seed,limit),
    trace:(mode,m,seed,limit)=>api.trace_game(kind,mode,m,seed,limit)};
}

function testModel(runner, game, model, seed, count) {
  const metrics=stats();
  for (let i=0; i<count; i++) record(metrics,runner.episode(evaluate,model,seed+i,game.limit));
  return metrics;
}

function options(argv) {
  const withJobs=argv.includes('--jobs');
  if (withJobs && argv.includes('--shard')) throw Error('--jobs and --shard cannot be combined');
  if (argv.filter(x=>x==='--jobs').length>1) throw Error('duplicate --jobs');
  const result={bend:process.env.BEND ?? 'bend', shard:[0,1], until:Infinity};
  for (let i=0;i<argv.length;i+=2) {
    const flag=argv[i], value=argv[i+1];
    if (value===undefined) throw Error('missing value for '+flag);
    if (flag==='--jobs') {
      if (!/^[1-9]\d*$/.test(value) || Number(value)>32) throw Error('--jobs requires an integer from 1 to 32');
      result.jobs=Number(value);
    } else if (flag==='--bend') result.bend=value;
    else if (flag==='--shard' && /^\d+\/[1-9]\d*$/.test(value)) {
      result.shard=value.split('/').map(Number);
      if (!result.shard.every(Number.isSafeInteger) || result.shard[0]>=result.shard[1]) throw Error('shard index starts at zero and must be below the total');
    } else if (flag==='--until' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) result.until=Number(value);
    else throw Error('invalid option '+flag+' '+value);
  }
  return result;
}

const allGames=plan=>[...plan.games,...(plan.evaluationGames??[])];

function sourceFiles(plan) {
  const files=new Map();
  function add(name) {
    if (files.has(name)) return;
    const bytes=fs.readFileSync(path.join(here,name));
    files.set(name,bytes);
    for (const m of bytes.toString().matchAll(/^import (\.\/[\w./-]+\.bend) as /gm)) {
      add(path.join(path.dirname(name),m[1]));
    }
  }
  add('study.bend');
  add('experiment.mjs');
  add('experiment_config.mjs');
  add('assessment.mjs');
  add('finite_world.mjs');
  add('agent_source.mjs');
  add('process_output.mjs');
  add('parallel_trials.mjs');
  add('parameters.bend');
  add('finite.bend');
  add('history.bend');
  add('cursor.bend');
  add('logged.bend');
  add('offline.bend');
  const bundles=[...plan.arms.filter(a=>a.method==='custom').map(a=>a.agent),...allGames(plan).filter(g=>g.world).map(g=>g.world)];
  for (const bundle of bundles) {
    for (const [name,source] of Object.entries(bundle.files)) {
      files.set(name,Buffer.from(source));
      for (const m of source.matchAll(/^\s*import \.\/([\w-]+\.bend) as /gm)) {
        if (!Object.hasOwn(bundle.files,m[1])) add(m[1]);
      }
    }
  }
  return files;
}

function bridgeFunctions(plan) {
  const builtins={doors:['Doors.Hall','Doors'],orchard:['Bool','Orchard'],cliff:['U32','Cliff'],
    ferry:['Ferry.Stage','Ferry'],key_maze:['Maze.State','Maze'],noisy_fork:['Fork.State','Fork'],
    mountain_car:['Car.State','Car'],cartpole:['Pole.State','Pole']};
  let code=''; const seen=new Set();
  for (const game of allGames(plan)) for (const arm of plan.arms) {
    const name=adapterName(game,arm);
    if (seen.has(name)) continue;
    seen.add(name);
    const domain=game.domain??game.id;
    const car=domain==='mountain_car', pole=domain==='cartpole';
    const obs=game.world?'A'+game.world.entry+'.Observation':car?'Car.State':pole?'Pole.State':'U32', model=arm.method==='custom'?'A'+arm.agent.entry+'.Model':car?'Tile.Model':pole?'AC.Model':'Model';
    let state,world;
    if (game.world) {
      const module='A'+game.world.entry;
      const params=Object.entries(game.parameters).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>
        'Params.Parameter{'+JSON.stringify(key)+','+floatLiteral(value)+'}').join(',');
      state=module+'.State'; world=module+'.world(['+params+'])';
    } else if (game.definition) {
      const previous=arm.observation==='previous';
      state=previous?'H.State<U32,H.Previous>':'U32';
      world='G'+symbol(game.definition)+'.'+(previous?'history_world()':'world()');
    } else {
      const [s,module]=builtins[game.id]; state=s; world=module+'.world()';
    }
    const module=arm.method==='custom'?'A'+arm.agent.entry+'.':car?'Tile.':pole?'AC.':'';
    const hooks='~'+state+', ~'+obs+', ~'+model+', ~E.Hooks{'+world+', '+module+'act, '+module+'learn}';
    const types=state+','+obs+','+model;
    if (game.definition || game.world || arm.method==='custom') {
      code+='\ndef '+name+'(mode: E.Mode, model: '+model+', seed: U32, limit: Nat) -> E.Report<'+model+'>:\n'+
        '  E.episode('+hooks+',mode,model,seed,limit)\n'+
        '\ndef trace_'+name+'(mode: E.Mode, model: '+model+', seed: U32, limit: Nat) -> E.Observed<List<&2,E.Frame<'+obs+'>>,'+model+'>:\n'+
        '  E.trace('+hooks+',mode,model,seed,limit)\n';
    }
    code+='\ndef collect_'+name+'(model: '+model+', seed: U32, limit: Nat, buckets: U32) -> E.Observed<List<&2,E.Frame<'+obs+'>>,Logged.Behavior<'+model+'>>:\n'+
      '  Logged.rollout(~'+state+', ~'+obs+', ~'+model+', ~'+world+', ~'+module+'act, model, seed, limit, buckets)\n'+
      '\ndef preferred_'+name+'(model: '+model+', obs: '+obs+', legal: List<&2,U32>) -> U32:\n'+
      '  Logged.base(~'+obs+', ~'+model+', ~'+module+'act, model, obs, legal)\n';
    if (!car && !pole && (!game.world || game.domain==='discrete')) {
      code+='\ndef offline_'+name+'(model: Offline.Policy, seed: U32, limit: Nat) -> E.Report<Offline.Policy>:\n'+
        '  E.episode(~'+state+', ~'+obs+', ~Offline.Policy, ~E.Hooks{'+world+', Offline.act, m => e => m}, E.Evaluate{}, model, seed, limit)\n';
    }
    if (plan.budgetUnit!=='steps') continue;
    code+='\ndef begin_'+name+'(model: '+model+', seed: U32, limit: Nat) -> Cursor.Cursor<'+types+'>:\n'+
      '  Cursor.start('+hooks+', model, seed, limit)\n'+
      '\ndef segment_'+name+'(mode: E.Mode, budget: Nat, cursor: Cursor.Cursor<'+types+'>) -> Cursor.Segment<'+types+'>:\n'+
      '  Cursor.segment('+hooks+', mode, budget, cursor)\n';
  }
  return code;
}

async function build(bend, dir, plan) {
  const env={...process.env,BEND_NO_TELEMETRY:'1'};
  const sources=sourceFiles(plan);
  const authored=new Map(allGames(plan).filter(g=>g.definition).map(g=>[symbol(g.definition),g.definition]));
  let imports='import ./logged.bend as Logged\nimport ./offline.bend as Offline\nimport ./history.bend as H\nimport ./cursor.bend as Cursor\nimport ./parameters.bend as Params\n';
  let entry=sources.get('study.bend').toString();
  for (const [name,def] of authored) {
    sources.set(name+'.bend',Buffer.from(bendSource(def)));
    imports+='import ./'+name+'.bend as G'+name+'\n';
  }
  const customAgents=new Set(plan.arms.filter(a=>a.method==='custom').map(a=>a.agent.entry));
  const customModules=new Set([...customAgents,...allGames(plan).filter(g=>g.world).map(g=>g.world.entry)]);
  for (const name of customModules) {
    imports+='import ./'+name+'.bend as A'+name+'\n';
    if (customAgents.has(name)) {
      entry+='\ndef initial_'+name+'(seed: U32, p: Params.Parameters) -> A'+name+'.Model:\n  A'+name+'.initial(seed,p)\n';
    }
  }
  sources.set('study.bend',Buffer.from(imports+entry+bridgeFunctions(plan)));
  for (const [name,bytes] of sources) {
    fs.mkdirSync(path.join(dir,path.dirname(name)),{recursive:true});
    fs.writeFileSync(path.join(dir,name),bytes);
  }
  for (const name of customModules) await execute(bend,[path.join(dir,name+'.bend'),'--check-only'],{env});
  const version=(await execute(bend,['version'],{env})).stdout.trim();
  const file=path.join(dir,'study.mjs');
  await execute(bend,[path.join(dir,'study.bend'),'-o',file],{env});
  const backend=digest(fs.readFileSync(file));
  const hashes=Object.fromEntries([...sources].map(([k,v])=>[k,digest(v)]));
  const api=(await import(pathToFileURL(file).href)).default;
  return {api,sources,compiled:fs.readFileSync(file),toolchain:{bend:version,node:process.versions.node,backend,sources:hashes}};
}

function trialFile(root,t,n) {
  return path.join(root,'trials',t.game.id,t.arm.id,String(t.rep),String(n)+'.json');
}

function existing(root,identity,t,n,previous) {
  const f=trialFile(root,t,n);
  if (!fs.existsSync(f)) return null;
  const row=unseal(f);
  const b=row.body;
  if (b.experiment!==identity || b.parent!==previous || b.game!==t.game.id || b.arm!==t.arm.id || b.rep!==t.rep || b.episodes!==n) {
    throw Error('checkpoint identity or chain mismatch: '+f);
  }
  return row;
}

function runTrial(api,root,manifest,t,until) {
  const p=manifest.body.plan;
  const runner=gameRunner(api,t.game,t.arm);
  let model=runner.initial(settings(t.arm,t.game),seedOf(p,t.rep,'train')), training=stats(), previous=null, done=0;
  let created=0,partial=null,started=0;
  const first=seedOf(p,t.rep,'train');
  for (const n of p.checkpoints) {
    if (n>until) break;
    const saved=existing(root,manifest.hash,t,n,previous);
    if (saved) {
      model=saved.body.model; training=saved.body.train; previous=saved.hash; done=n;
      partial=saved.body.partial??null; started=saved.body.started??training.episodes;
      continue;
    }
    if (p.budgetUnit==='steps') {
      while (training.steps+(partial?.steps??0)<n) {
        if (!partial) {
          if (started>=p.maxTrainEpisodes) throw Error('step budget exhausted maxTrainEpisodes at '+trialFile(root,t,n));
          partial={cursor:runner.begin(model,first+started,t.game.limit),steps:0,score:0};
          started++;
        }
        const needed=n-training.steps-partial.steps;
        const segment=runner.segment(train,needed,partial.cursor);
        model=segment.model;
        if (segment.finished.$==='Some') {
          record(training,segment.finished.value);
          partial=null;
        } else {
          if (segment.steps-partial.steps!==needed) throw Error('Bend segment failed to meet its interaction budget');
          partial={cursor:segment.cursor,steps:segment.steps,score:segment.score};
        }
      }
    } else {
      for (let i=done;i<n;i++) {
        const report=runner.episode(train,model,first+i,t.game.limit);
        record(training,report);
        model=report.model;
      }
      started=n;
    }
    const validation=testModel(runner,t.game,model,seedOf(p,t.rep,'validation'),p.validationEpisodes);
    const final=n===p.checkpoints.at(-1);
    const test=final && p.testEpisodes>0?testModel(runner,t.game,model,seedOf(p,t.rep,'test'),p.testEpisodes):null;
    const body={experiment:manifest.hash,parent:previous,game:t.game.id,arm:t.arm.id,rep:t.rep,
      episodes:n,model,train:training,partial,started,validation,test};
    const bytes=seal(body);
    immutable(trialFile(root,t,n),bytes);
    previous=JSON.parse(bytes).hash; done=n; created++;
  }
  return created;
}

function readPlan(config) {
  const input=json(config);
  const resolveGame=g=>{
    if (g && Object.hasOwn(g,'worldFile')) {
      if (g.world!==undefined || g.file!==undefined || typeof g.worldFile!=='string') throw Error('game must select one world source');
      const {worldFile,...rest}=g;
      return {...rest,world:bundleAgent(path.resolve(path.dirname(config),worldFile),here)};
    }
    if (!g || !Object.hasOwn(g,'file')) return g;
    if (g.definition!==undefined || typeof g.file!=='string') throw Error('game must supply one definition or file');
    const {file,...rest}=g;
    return {...rest,definition:json(path.resolve(path.dirname(config),file))};
  };
  for (const key of ['games','evaluationGames']) if (Array.isArray(input[key])) input[key]=input[key].map(resolveGame);
  if (Array.isArray(input.arms)) input.arms=input.arms.map(a=>{
    if (!a || !Object.hasOwn(a,'agentFile')) return a;
    if (a.agent!==undefined || typeof a.agentFile!=='string') throw Error('arm must select one agent source');
    const {agentFile,...rest}=a;
    return {...rest,agent:bundleAgent(path.resolve(path.dirname(config),agentFile),here)};
  });
  return validate(input);
}

async function run(config,root,args) {
  const plan=readPlan(config);
  const opts=options(args);
  if (opts.until!==Infinity && !plan.checkpoints.includes(opts.until)) throw Error('--until must be a declared checkpoint');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bend-study-'));
  try {
    const {api,sources,compiled,toolchain}=await build(opts.bend,dir,plan);
    const bytes=seal({plan,toolchain});
    // Publish the manifest last. A partial build can safely be retried.
    if (fs.existsSync(manifestPath(root)) && fs.readFileSync(manifestPath(root),'utf8')!==bytes) {
      throw Error('output contains a different experiment or toolchain; use resume for the saved experiment');
    }
    for (const [name,contents] of sources) immutable(path.join(root,'code',name),contents);
    immutable(path.join(root,'code','backend.mjs'),compiled);
    immutable(manifestPath(root),bytes);
    return executeTrials(api,root,JSON.parse(bytes),opts);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

function executeTrials(api,root,manifest,opts) {
  const plan=manifest.body.plan;
  if (opts.until!==Infinity && !plan.checkpoints.includes(opts.until)) throw Error('--until must be a declared checkpoint');
  if (opts.jobs>1) return parallelTrials(root,manifest,opts);
  let index=0,finished=0,created=0;
  // The CLI stays human-readable. A supervised worker additionally returns
  // exact counters to its owner, without parsing progress text.
  if (process.send && process.env.BEND_REPORT_SHARD===opts.shard.join('/')) {
    process.once('beforeExit',()=>{if(process.connected) process.send({shard:opts.shard.join('/'),finished,created});});
  }
  for (const t of trials(plan)) {
    if (index++%opts.shard[1]!==opts.shard[0]) continue;
    created+=runTrial(api,root,manifest,t,opts.until);
    finished++;
  }
  console.log(plan.name+': '+finished+' trials visited, '+created+' checkpoints written.');
}

async function frozen(root) {
  const manifest=unseal(manifestPath(root));
  const tc=manifest.body.toolchain;
  if (tc.node!==process.versions.node) throw Error('this experiment used Node '+tc.node);
  for (const name of ['experiment.mjs','experiment_config.mjs','finite_world.mjs','agent_source.mjs','process_output.mjs']) {
    if (digest(fs.readFileSync(path.join(here,name)))!==tc.sources[name]) {
      throw Error('use the archived runner: node '+path.join(root,'code','experiment.mjs')+' resume '+root);
    }
  }
  const file=path.join(root,'code','backend.mjs');
  if (digest(fs.readFileSync(file))!==tc.backend) throw Error('saved Bend backend checksum mismatch');
  return {manifest,api:(await import(pathToFileURL(file).href)).default};
}

function checkedSnapshot(root, manifest) {
  const tc=manifest.body.toolchain;
  const files=new Map();
  for (const [name,expected] of Object.entries({...tc.sources,'backend.mjs':tc.backend})) {
    const bytes=fs.readFileSync(path.join(root,'code',name));
    if (digest(bytes)!==expected) throw Error('snapshot checksum mismatch: '+name);
    files.set(name,bytes);
  }
  return files;
}

async function parallelTrials(root,manifest,opts) {
  // Resume executes archived code: verify its bytes before launching any child.
  checkedSnapshot(root,manifest);
  if (!Object.hasOwn(manifest.body.toolchain.sources,'parallel_trials.mjs'))
    throw Error('this archive predates --jobs; use its archived --shard option');
  const {launchShards}=await import(pathToFileURL(path.join(root,'code','parallel_trials.mjs')).href);
  const p=manifest.body.plan;
  return launchShards(root,opts.jobs,opts.until,p.name,p.games.length*p.arms.length*p.replicates);
}

async function rerun(root, target, args) {
  if (args.includes('--jobs')) throw Error('--jobs is supported only by run and resume');
  if (root===target || fs.existsSync(manifestPath(target))) throw Error('rerun needs a fresh output directory');
  const opts=options(args);
  const {api,manifest}=await frozen(root);
  const files=checkedSnapshot(root,manifest);
  for (const [name,bytes] of files) immutable(path.join(target,'code',name),bytes);
  immutable(manifestPath(target),fs.readFileSync(manifestPath(root)));
  executeTrials(api,target,manifest,opts);
}

function unpack(list) {
  const items=[];
  for (;list.$==='Con';list=list.tail) items.push(list.head);
  if (list.$!=='Nil') throw Error('invalid Bend list');
  return items;
}

function frameData(frame) {
  const data={observation:frame.observation,legal:unpack(frame.legal),action:frame.action,accepted:frame.$==='Applied'};
  if (data.accepted) {
    data.reward=frame.reward;
    data.nextObservation=frame.next.observation;
    data.nextLegal=frame.next.$==='Open'?unpack(frame.next.actions):[];
    data.terminal=frame.next.$==='End';
    data.truncated=frame.truncated;
  }
  return data;
}

async function replay(root,gameId,armId,repArg,atArg,phase,indexArg) {
  const {api,manifest}=await frozen(root), p=manifest.body.plan;
  const game=p.games.find(g=>g.id===gameId), arm=p.arms.find(a=>a.id===armId);
  const rep=Number(repArg), at=Number(atArg), index=Number(indexArg);
  if (!game || !arm || !Number.isInteger(rep) || rep<0 || rep>=p.replicates || !p.checkpoints.includes(at) ||
      !Number.isSafeInteger(index) || index<0) throw Error('invalid replay coordinates');
  if (!['train','validation','test'].includes(phase)) throw Error('unknown replay phase');
  const rows=[];
  let prev=null;
  for (const n of p.checkpoints) {
    const saved=existing(root,manifest.hash,{game,arm,rep},n,prev);
    if (!saved) break;
    rows.push(saved.body);
    prev=saved.hash;
    if (phase!=='train' && n===at) break;
  }
  const row=rows.find(r=>r.episodes===at);
  if (!row) throw Error('missing replay checkpoint');
  const runner=gameRunner(api,game,arm), base=seedOf(p,rep,phase);
  let model=row.model, prefix=null;
  if (phase==='train') {
    const last=rows.at(-1);
    if (index<row.train.episodes || index>=(last.started??last.train.episodes)) throw Error('training episode is outside recorded progress');
    // A checkpoint can land inside the requested episode. Use the nearest
    // earlier snapshot that can reconstruct the decision at its start.
    const from=rows.filter(b=>b.episodes<=at && (b.started??b.train.episodes)<=index).at(-1);
    if (!from) throw Error('no checkpoint preceding the requested training episode');
    model=from.model;
    let begin=from.train.episodes;
    if (from.partial) {
      const end=runner.segment(train,game.limit,from.partial.cursor);
      if (end.finished.$!=='Some') throw Error('incomplete saved episode horizon');
      model=end.model; begin++;
    }
    for (let i=begin;i<index;i++) model=runner.episode(train,model,base+i,game.limit).model;
    if (last.partial && last.train.episodes===index) prefix=last;
  } else {
    if (index>=(phase==='validation'?p.validationEpisodes:p.testEpisodes) ||
        (phase==='test' && (!row.test || at!==p.checkpoints.at(-1)))) throw Error('episode is outside the recorded evaluation phase');
  }
  const traced=runner.trace(phase==='train'?train:evaluate,model,base+index,game.limit);
  const frames=unpack(traced.record).map(frameData);
  const result={experiment:manifest.hash,game:gameId,arm:armId,replicate:rep,checkpoint:at,phase,index,seed:base+index,
    initialModel:digest(canonical(model)),finalModel:digest(canonical(prefix?prefix.model:traced.report.model)),
    score:prefix?prefix.partial.score:traced.report.score,steps:prefix?prefix.partial.steps:traced.report.steps,
    reason:prefix?{$:'Paused'}:traced.report.reason,frames:prefix?frames.slice(0,prefix.partial.steps):frames};
  process.stdout.write(numberPreservingJson(result,2)+'\n');
}

function exportCsv(root) {
  const m=unseal(manifestPath(root)), p=m.body.plan;
  const keys=Object.keys(stats());
  const values=(phase)=>keys.map(k=>phase?.[k]??'');
  const name=['game','arm','replicate','budget_unit','budget','trained_episodes','partial_steps','partial_return','interaction_steps','train_seed','validation_seed','test_seed',
    ...['train','validation','test'].flatMap(phase=>keys.map(k=>phase+'_'+k))];
  const lines=[name.join(',')];
  for (const t of trials(p)) {
    let prev=null;
    for (const n of p.checkpoints) {
      const saved=existing(root,m.hash,t,n,prev);
      if (!saved) throw Error('missing checkpoint: '+trialFile(root,t,n));
      const b=saved.body; prev=saved.hash;
      lines.push([t.game.id,t.arm.id,t.rep,p.budgetUnit??'episodes',n,b.train.episodes,b.partial?.steps??0,b.partial?.score??0,
        b.train.steps+(b.partial?.steps??0),...['train','validation','test'].map(k=>seedOf(p,t.rep,k)),
        ...values(b.train),...values(b.validation),...values(b.test)].join(','));
    }
  }
  process.stdout.write(lines.join('\n')+'\n');
}

function selectStudy(root,specFile,output) {
  const m=unseal(manifestPath(root)), p=m.body.plan, spec=json(specFile);
  if (p.testEpisodes!==0 || p.games.length!==1) throw Error('selection requires a single-game screening run with testEpisodes zero');
  const required=['metric','reference','name','replicates','checkpoints','validationEpisodes','testEpisodes','seeds'];
  const allowed=[...required,'maxTrainEpisodes'];
  if (Object.keys(spec).some(k=>!allowed.includes(k)) || required.some(k=>!Object.hasOwn(spec,k))) throw Error('invalid confirmation specification');
  if (!['return','completion'].includes(spec.metric)) throw Error('selection metric must be return or completion');
  if (!p.arms.some(a=>a.id===spec.reference)) throw Error('reference arm is absent from the screen');
  if (p.arms.length<2 || !p.validationEpisodes) throw Error('selection needs a challenger and validation episodes');
  if (spec.testEpisodes<1) throw Error('confirmation requires held-out test episodes');
  const scores=new Map(p.arms.map(a=>[a.id,0]));
  const final=p.checkpoints.at(-1);
  for (const t of trials(p)) {
    let previous=null;
    for (const n of p.checkpoints) {
      const item=existing(root,m.hash,t,n,previous);
      if (!item) throw Error('screen is incomplete at '+trialFile(root,t,n));
      previous=item.hash;
      if (n===final) {
        const v=item.body.validation;
        const metric=(spec.metric==='return'?v.sum:v.terminal)/v.episodes;
        scores.set(t.arm.id,scores.get(t.arm.id)+metric/p.replicates);
      }
    }
  }
  const ranking=[...scores].sort((a,b)=>b[1]-a[1]);
  const winner=ranking[0][0];
  const challenger=ranking.find(([id])=>id!==spec.reference)[0];
  const arms=p.arms.filter(a=>a.id===challenger || a.id===spec.reference).map(({buckets,...a})=>a);
  const {reference,metric,...design}=spec;
  const raw={schema:1,budgetUnit:p.budgetUnit??'episodes',...design,games:p.games,arms};
  const confirm=validate(raw);
  checkSeedBlocks([p,confirm]);
  const selection=seal({screen:m.hash,metric,reference,winner,challenger,checkpoint:final,ranking,
    confirmationPlan:digest(canonical(confirm))});
  immutable(path.join(output,'selection.json'),selection);
  immutable(path.join(output,'plan.json'),numberPreservingJson(raw,2)+'\n');
  console.log('Selected '+winner+' on '+metric+' across '+p.replicates+' validation blocks. Confirmation plan: '+path.join(output,'plan.json'));
}

function validMetrics(s, expected, limit) {
  if (!s || !['episodes','steps','terminal','limited','illegal'].every(k=>Number.isSafeInteger(s[k]) && s[k]>=0) ||
      !['sum','mean','m2'].every(k=>Number.isFinite(s[k])) || s.m2<0 ||
      s.episodes!==expected || s.terminal+s.limited+s.illegal!==expected || s.steps>expected*limit ||
      (expected===0?(s.min!==null || s.max!==null):(s.min>s.max || !Number.isFinite(s.min) || !Number.isFinite(s.max)))) {
    throw Error('invalid checkpoint metrics');
  }
}

function verifyBody(p,t,n,b) {
  validMetrics(b.train,b.train.episodes,t.game.limit);
  validMetrics(b.validation,p.validationEpisodes,t.game.limit);
  if (n===p.checkpoints.at(-1) && p.testEpisodes) validMetrics(b.test,p.testEpisodes,t.game.limit);
  else if (b.test!==null) throw Error('unexpected test data');
  if (p.budgetUnit==='steps') {
    if (b.train.steps+(b.partial?.steps??0)!==n || b.started!==b.train.episodes+Number(!!b.partial) ||
        b.started>p.maxTrainEpisodes || (b.partial && (b.partial.steps<1 || b.partial.steps>=t.game.limit))) {
      throw Error('interaction budget or partial episode mismatch');
    }
  } else if (b.train.episodes!==n || b.partial) throw Error('episode budget mismatch');
}

function status(root,verify=false) {
  const m=unseal(manifestPath(root)), p=m.body.plan;
  if (verify) checkedSnapshot(root,m);
  let complete=0, saved=0, total=0;
  for (const t of trials(p)) {
    total++;
    let prev=null;
    for (const n of p.checkpoints) {
      if (verify) {
        const item=existing(root,m.hash,t,n,prev);
        if (!item) throw Error('missing checkpoint: '+trialFile(root,t,n));
        verifyBody(p,t,n,item.body);
        prev=item.hash;
      } else if (!fs.existsSync(trialFile(root,t,n))) break;
      saved++;
      if (n===p.checkpoints.at(-1)) complete++;
    }
  }
  console.log(JSON.stringify({experiment:p.name,completeTrials:complete,totalTrials:total,savedCheckpoints:saved,totalCheckpoints:total*p.checkpoints.length}));
}

async function main(argv) {
  const [cmd,arg,...rest]=argv;
  // Leave ordinary run/resume reporting untouched, including older archives.
  if ((cmd==='run'||cmd==='resume') && arg && rest.includes('--jobs')) {
    const flags=cmd==='run'?rest.slice(1):rest, opts=options(flags);
    if (cmd==='run' && !rest[0]) throw Error('run requires an output directory');
    if (opts.jobs===1) {
      const i=flags.indexOf('--jobs');
      return main([cmd,arg,...(cmd==='run'?[rest[0]]:[]),...flags.slice(0,i),...flags.slice(i+2)]);
    }
    if (cmd==='run') return run(arg,path.resolve(rest[0]),flags);
    const root=path.resolve(arg), {manifest}=await frozen(root);
    if (opts.until!==Infinity && !manifest.body.plan.checkpoints.includes(opts.until))
      throw Error('--until must be a declared checkpoint');
    return parallelTrials(root,manifest,opts);
  }
  if (cmd==='validate'&&arg&&rest.length===0) {
    const p=readPlan(arg); console.log('Valid plan: '+p.name+', '+p.games.length*p.arms.length*p.replicates+' trials.'); return;
  }
  if (cmd==='oracle'&&arg&&(rest.length===1 || (rest.length===2 && rest[1]==='--reactive'))) {
    const solve=rest.length===2?reactiveOracle:oracle;
    console.log(JSON.stringify(solve(worldDefinition(json(arg)),Number(rest[0])),null,2)); return;
  }
  if (cmd==='run'&&arg&&rest.length>=1) return run(arg,path.resolve(rest[0]),rest.slice(1));
  if (cmd==='resume'&&arg) {
    const root=path.resolve(arg), opts=options(rest);
    const {api,manifest}=await frozen(root);
    return executeTrials(api,root,manifest,opts);
  }
  if (cmd==='assess' && arg && rest.length===2) {
    const {assess}=await import('./assessment.mjs');
    return assess(path.resolve(arg),rest[0],path.resolve(rest[1]));
  }
  if (cmd==='rerun' && arg && rest.length>=1) return rerun(path.resolve(arg),path.resolve(rest[0]),rest.slice(1));
  if (cmd==='select'&&arg&&rest.length===2) return selectStudy(path.resolve(arg),rest[0],path.resolve(rest[1]));
  if (cmd==='export'&&arg&&rest.length===0) return exportCsv(path.resolve(arg));
  if ((cmd==='status'||cmd==='verify')&&arg&&rest.length===0) return status(path.resolve(arg),cmd==='verify');
  if (cmd==='replay'&&arg&&rest.length===6) return replay(path.resolve(arg),...rest);
  throw Error('usage: node experiment.mjs validate PLAN | oracle WORLD HORIZON [--reactive] | run PLAN OUTPUT [--bend PATH] [--until EPISODES] [--shard I/N | --jobs N] | resume OUTPUT [--until EPISODES] [--shard I/N | --jobs N] | assess OUTPUT ASSESSMENT_SPEC DIRECTORY | rerun OUTPUT NEW_OUTPUT [--until BUDGET] | select SCREEN CONFIRM_SPEC OUTPUT | status OUTPUT | verify OUTPUT | export OUTPUT | replay OUTPUT GAME ARM REP CHECKPOINT PHASE INDEX');
}

export {adapterName, allGames, frameData, record, stats, unpack, checkedSnapshot, existing, gameRunner, immutable, json, manifestPath, seal, testModel, unseal};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
