import { compilerTest } from './bend_test_support.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execute} from './process_output.mjs';
import {canonical,checkSeedBlocks,validate} from './experiment_config.mjs';
import {buckets,numberPreservingJson,worldDefinition,oracle,reactiveOracle,symbol} from './finite_world.mjs';
import {bundleAgent} from './agent_source.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const cli=path.join(here,'experiment.mjs');
const bend=process.env.BEND??'bend';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,x)=>fs.writeFileSync(file,JSON.stringify(x,null,2));
const invoke=(...args)=>execute(process.execPath,[cli,...args]);
function directory(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bend-experiment-test-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  return dir;
}
function plan(changes={}) {
  return {schema:1,name:'integration',games:[{id:'ferry',limit:3}],
    arms:[{id:'q',method:'q_learning'},{id:'d',method:'double_q'}],
    replicates:2,checkpoints:[0,3,9],validationEpisodes:3,testEpisodes:5,
    seeds:{train:1,validation:1001,test:2001,stride:100},...changes};
}

test('configuration checks overlaps across phases, replicates, stages and the U32 boundary',()=>{
  const p=plan();
  assert.throws(()=>validate({...p,seeds:{...p.seeds,validation:8}}),/overlapping/);
  assert.throws(()=>validate({...p,seeds:{...p.seeds,stride:4}}),/overlapping/);
  assert.throws(()=>validate({...p,seeds:{...p.seeds,test:0xffffffff}}),/U32/);
  assert.throws(()=>checkSeedBlocks([validate(p),validate(p)]),/overlapping/);
  assert.throws(()=>validate({...p,arms:[{id:'q',method:'network_ac'}]}),/incompatible/);
  assert.throws(()=>validate({...p,checkpoints:[0,3,3]}),/increase/);
});

test('checkpoint representation preserves signed zero and rejects numeric divergence',()=>{
  assert.ok(Object.is(JSON.parse(canonical({x:-0})).x,-0));
  assert.throws(()=>canonical({x:NaN}),/non-finite/);
  assert.throws(()=>canonical({x:Infinity}),/non-finite/);
  let deep=null;
  for (let i=0;i<20000;i++) deep={tail:deep};
  assert.equal(canonical(deep).length,9*20000+4);
  const world=worldDefinition(read(path.join(here,'worlds','bridge.json')));
  const event=world.states[0].actions[0].outcomes[0];
  event.reward=0;
  const plus=symbol(world);
  event.reward=-0;
  assert.notEqual(plus,symbol(world));
  assert.ok(Object.is(JSON.parse(numberPreservingJson(world)).states[0].actions[0].outcomes[0].reward,-0));
});

test('authored world validation and independent finite-horizon values',()=>{
  const bridge=worldDefinition(read(path.join(here,'worlds','bridge.json')));
  assert.equal(oracle(bridge,1).optimalFullStateReturn,1);
  assert.equal(oracle(bridge,2).optimalFullStateReturn,2);
  assert.equal(oracle(bridge,2).uniformReturn,1.5);
  const cue=worldDefinition(read(path.join(here,'worlds','remember-the-cue.json')));
  assert.equal(reactiveOracle(cue,2).optimalStationaryReactiveReturn,.5);
  assert.equal(reactiveOracle(cue,2).optimalFullStateReturn,1);
  assert.throws(()=>worldDefinition({...bridge,initial:[{to:123,weight:1}]}),/destination/);
  assert.throws(()=>worldDefinition({...bridge,initial:[{to:0,weight:0}]}),/positive/);
  assert.deepEqual(buckets([{to:1,weight:1},{to:0,weight:0xffffffff}]).map(x=>x.upper),[0,0xffffffff]);
});

test('source graph follows local agent helpers and changes identity when a helper changes',t=>{
  const d=directory(t), entry=path.join(d,'agent.bend'), helper=path.join(d,'helper.bend');
  fs.writeFileSync(entry,'import ./helper.bend as H\nimport ./engine.bend as E\n');
  fs.writeFileSync(helper,'import Base\ndef zero() -> U32: 0\n');
  const first=bundleAgent(entry,here);
  assert.equal(Object.keys(first.files).length,2);
  fs.appendFileSync(helper,'# revision\n');
  assert.notEqual(bundleAgent(entry,here).entry,first.entry);
  fs.writeFileSync(helper,'import ./agent.bend as A\n');
  assert.throws(()=>bundleAgent(entry,here),/cyclic/);
});

test('interruption, concurrent resume, independent rerun and checksum rejection',compilerTest,async t=>{
  const d=directory(t), cfg=path.join(d,'p.json'), one=path.join(d,'one'), two=path.join(d,'two');
  write(cfg,plan());
  await invoke('run',cfg,one,'--bend',bend,'--until','3');
  const partial=JSON.parse((await invoke('status',one)).stdout);
  assert.equal(partial.completeTrials,0);
  assert.equal(partial.savedCheckpoints,8);
  await assert.rejects(invoke('export',one),/missing checkpoint/);
  await Promise.all([invoke('resume',one),invoke('resume',one)]);
  await invoke('run',cfg,two,'--bend',bend);
  assert.equal((await invoke('export',one)).stdout,(await invoke('export',two)).stdout);
  const f=path.join('trials','ferry','q','0','9.json');
  assert.equal(fs.readFileSync(path.join(one,f),'utf8'),fs.readFileSync(path.join(two,f),'utf8'));
  await invoke('verify',one);
  const third=path.join(d,'three');
  await invoke('rerun',one,third);
  assert.equal(fs.readFileSync(path.join(one,f),'utf8'),fs.readFileSync(path.join(third,f),'utf8'));
  await assert.rejects(invoke('rerun',one,third),/fresh output/);
  const trace=JSON.parse((await invoke('replay',one,'ferry','q','0','9','test','2')).stdout);
  assert.equal(trace.initialModel,trace.finalModel);
  assert.equal(trace.steps,trace.frames.length);
  assert.equal(trace.score,trace.frames.reduce((sum,f)=>Math.fround(sum+f.reward),0));
  write(cfg,plan({testEpisodes:6}));
  await assert.rejects(invoke('run',cfg,one,'--bend',bend),/different experiment/);
  const corrupt=read(path.join(one,f));corrupt.body.test.sum++;
  write(path.join(one,f),corrupt);
  await assert.rejects(invoke('verify',one),/checksum/);
});

test('mid-episode pause preserves every update, horizon and replayed prefix',compilerTest,async t=>{
  const d=directory(t), cfg=path.join(d,'p.json'), one=path.join(d,'one'), two=path.join(d,'two');
  const game={id:'walk',limit:5,definition:{schema:1,initial:[{to:0,weight:1}],states:[{id:0,actions:[
    {id:11,outcomes:[{to:0,weight:1,reward:1}]}
  ]}]}};
  const base=plan({budgetUnit:'steps',games:[game],arms:[{id:'q',method:'q_learning'}],replicates:1});
  write(cfg,{...base,checkpoints:[0,1,4,7,12]});
  await invoke('run',cfg,one,'--bend',bend,'--until','4');
  const prefix=JSON.parse((await invoke('replay',one,'walk','q','0','4','train','0')).stdout);
  assert.equal(prefix.reason.$,'Paused');assert.equal(prefix.steps,4);assert.equal(prefix.score,4);
  assert.ok(prefix.frames.every(f=>!f.truncated));
  await invoke('resume',one);
  const full=JSON.parse((await invoke('replay',one,'walk','q','0','4','train','0')).stdout);
  assert.equal(full.reason.$,'Limit');assert.equal(full.frames.at(-1).truncated,true);
  const readFinal=root=>read(path.join(root,'trials','walk','q','0','12.json')).body;
  const result=readFinal(one);
  assert.equal(result.partial.steps,2);assert.equal(result.train.steps,10);assert.equal(result.train.limited,2);
  write(cfg,{...base,checkpoints:[0,12]});
  await invoke('run',cfg,two,'--bend',bend);
  const direct=readFinal(two);
  for (const k of ['partial','model','train','validation','test']) assert.deepEqual(result[k],direct[k]);
});

test('screening uses validation only and confirmation seed reuse is rejected',compilerTest,async t=>{
  const d=directory(t), cfg=path.join(d,'p.json'), root=path.join(d,'screen'), out=path.join(d,'decision'), spec=path.join(d,'confirm.json');
  const p=plan({testEpisodes:0,budgetUnit:'steps'});
  write(cfg,p);
  await invoke('run',cfg,root,'--bend',bend);
  const options={name:'confirm',reference:'q',metric:'return',replicates:2,checkpoints:[0,9],validationEpisodes:3,testEpisodes:5,seeds:p.seeds};
  write(spec,options);
  await assert.rejects(invoke('select',root,spec,out),/overlapping/);
  write(spec,{...options,seeds:{train:5001,validation:7001,test:9001,stride:100}});
  await invoke('select',root,spec,out);
  const selection=read(path.join(out,'selection.json')).body;
  assert.equal(selection.metric,'return');
  assert.equal(read(path.join(out,'plan.json')).budgetUnit,'steps');
  assert.ok(read(path.join(out,'plan.json')).arms.some(a=>a.id===selection.winner));
  const repeat=path.join(d,'reference-first');
  write(spec,{...read(spec),reference:selection.winner});
  await invoke('select',root,spec,repeat);
  const decision=read(path.join(repeat,'selection.json')).body;
  assert.equal(decision.winner,decision.reference);
  assert.notEqual(decision.challenger,decision.reference);
  assert.deepEqual(new Set(read(path.join(repeat,'plan.json')).arms.map(a=>a.id)),
    new Set([decision.reference,decision.challenger]));
  await assert.rejects(invoke('replay',root,'ferry','q','0','9','test','0'),/outside/);
});

test('transfer targets receive frozen models and validation ties choose the earliest eligible checkpoint',compilerTest,async t=>{
  const d=directory(t), cfg=path.join(d,'plan.json'), root=path.join(d,'study'), file=path.join(d,'assess.json'), out=path.join(d,'result');
  const world=reward=>({schema:1,initial:[{to:0,weight:1}],states:[{id:0,actions:[{id:9,outcomes:[{to:1,weight:1,reward}]}]},{id:1,actions:[]}]});
  write(cfg,plan({games:[{id:'from',definition:world(1),limit:1}],evaluationGames:[{id:'to',definition:world(-3),limit:1}],
    arms:[{id:'q',method:'q_learning'}],replicates:1}));
  await invoke('run',cfg,root,'--bend',bend);
  assert.ok(!fs.existsSync(path.join(root,'trials','to')));
  const spec={schema:1,name:'transfer',comparisons:[{id:'chosen',source:'from',arm:'q',checkpoint:'best-validation',minimumBudget:3}],
    targets:['from','to'],episodes:8,seeds:{start:1001,stride:200}};
  write(file,spec);
  await assert.rejects(invoke('assess',root,file,out),/overlapping/);
  spec.seeds.start=45000;write(file,spec);await invoke('assess',root,file,out);
  const rows=['from','to'].map(g=>read(path.join(out,'trials',g,'chosen','0.json')).body);
  assert.deepEqual(rows.map(x=>[x.budget,x.sum]),[[3,8],[3,-24]]);
  assert.equal(rows[0].model_hash,rows[1].model_hash);
  await invoke('assess',root,file,out);
});

test('optional run annotations reject oversize, malformed and linked files',async t=>{
  const {readRunNotes}=await import('./run_notes.mjs'),dir=directory(t),file=path.join(dir,'notes.json');
  assert.deepEqual(readRunNotes(dir),{});
  for(const content of ['not json','x'.repeat(17000),'{"tags":[""]}','{"notes":null}']){
    fs.writeFileSync(file,content);assert.ok(readRunNotes(dir).annotationWarning);
  }
  fs.writeFileSync(file,JSON.stringify({notes:'line one\n<script>x</script>',tags:['v1']}));
  assert.deepEqual(readRunNotes(dir).annotations.tags,['v1']);
  if(process.platform!=='win32'){
    fs.renameSync(file,file+'.bak');fs.symlinkSync(file+'.bak',file);assert.ok(readRunNotes(dir).annotationWarning);
  }
});

test('portable report embeds analyze.py rows and exact finite-world replay decisions',compilerTest,async t=>{
  const d=directory(t),root=path.join(d,'run'),file=path.join(d,'bridge.json'),out=path.join(d,'report.html');
  const p=plan({games:[{id:'bridge',definition:read(path.join(here,'worlds','bridge.json')),limit:2}],replicates:1,checkpoints:[0,2]});
  write(file,p);await invoke('run',file,root,'--bend',bend);await invoke('report',root,out);
  const html=fs.readFileSync(out,'utf8');
  assert.match(html,/<svg /);assert.doesNotMatch(html,/<line x1=/);assert.match(html,/Full-state optimum: 2; uniform baseline: 1.5/);
  assert.match(html,/Best test episode/);assert.match(html,/Worst test episode/);assert.match(html,/Decision gap/);
  assert.doesNotMatch(html,/<script\b|\b(?:src|href)\s*=/i);
  const csv=path.join(d,'metrics.csv');fs.writeFileSync(csv,(await invoke('export',root)).stdout);
  for(const phase of ['validation','test']){
    const {stdout}=await execute(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[path.join(here,'analyze.py'),csv,'--phase',phase]);
    for(const line of stdout.trimEnd().split(/\r?\n/).slice(1))
      assert.ok(html.includes('<tr>'+line.split(',').map(v=>'<td>'+v+'</td>').join('')+'</tr>'));
  }
  await assert.rejects(invoke('report',root,out),/EEXIST/);
});

test('local jobs resume byte-identically to serial using only the archive',compilerTest,async t=>{
  const dir=directory(t),cfg=path.join(dir,'plan.json'),a=path.join(dir,'serial'),b=path.join(dir,'parallel');
  write(cfg,plan());
  await invoke('run',cfg,a,'--bend',bend);
  await invoke('run',cfg,b,'--bend',bend,'--jobs','4','--until','3');
  const archived=path.join(b,'code','experiment.mjs');
  const resume=()=>execute(process.execPath,[archived,'resume',b,'--jobs','8'],{env:{...process.env,BEND:path.join(dir,'no-compiler')}});
  await resume();
  assert.match((await resume()).stdout,/0 checkpoints written/);
  const files=root=>fs.readdirSync(root,{recursive:true}).filter(f=>fs.statSync(path.join(root,f)).isFile()).sort();
  assert.deepEqual(files(a),files(b));
  for(const f of files(a)) assert.ok(fs.readFileSync(path.join(a,f)).equals(fs.readFileSync(path.join(b,f))),f);
  assert.equal(JSON.parse((await invoke('verify',b)).stdout).completeTrials,4);
});

test('invalid local worker counts and explicit shard combinations fail before compilation',async()=>{
  for(const opts of [['--jobs','0'],['--jobs','33'],['--jobs','2','--shard','0/2'],['--jobs','2','--jobs','2']])
    await assert.rejects(invoke('run','no-such-config','unused',...opts),/jobs/);
});

test('a failed local worker cancels its live peer before the supervisor returns',async t=>{
  const dir=directory(t),code=path.join(dir,'code'),ready=path.join(dir,'ready');
  fs.mkdirSync(code);
  fs.copyFileSync(path.join(here,'parallel_trials.mjs'),path.join(code,'parallel_trials.mjs'));
  fs.writeFileSync(path.join(code,'experiment.mjs'),`
    import fs from 'node:fs';
    const ready=process.argv[3]+'/ready';
    if(process.argv.at(-1)==='1/2'){
      fs.writeFileSync(ready,String(process.pid)); setInterval(()=>{},1000);
    }else{
      const timer=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(timer);process.exit(7)}},10);
    }
  `);
  const {launchShards}=await import('./parallel_trials.mjs');
  await assert.rejects(launchShards(dir,2,Infinity,'fixture',2),/shard 0\/2 failed/);
  const peer=Number(fs.readFileSync(ready,'utf8'));
  assert.throws(()=>process.kill(peer,0),{code:'ESRCH'});
});

test('optional custom finish is train-only, once per completed report, never per segment',compilerTest,async t=>{
  const d=directory(t), file=path.join(d,'counter.bend'), cfg=path.join(d,'p.json'), out=path.join(d,'run');
  fs.writeFileSync(file,`import Base
import ./engine.bend as E
import ./parameters.bend as P

type Model is Data:
  Counts{learns: U32, finishes: U32, reason: U32}

def initial(seed: U32,params: P.Parameters) -> Model: Counts{0,0,0}
def act(m: Model,o: U32,a: List<&2,U32>,mode: E.Mode,w: U32) -> U32: 0
def learn(m: Model,e: E.Transition<U32>) -> Model:
  Counts{n,f,r}=m
  Counts{U32.add(n,1),f,r}
def marker(stop: E.Stop) -> U32:
  match stop:
    case E.Terminal{}: 1
    case E.Limit{}: 2
    case E.Illegal{a}: 3
def finish(m: Model,stop: E.Stop) -> Model:
  Counts{n,f,r}=m
  Counts{n,U32.add(f,1),marker(stop)}
`);
  const game=(id,action,to,initial=0)=>{
    const definition={schema:1,initial:[{to:initial,weight:1}],states:[
      {id:0,actions:[{id:action,outcomes:[{to,reward:1,weight:1}]}]},{id:1,actions:[]}]};
    return {id,limit:3,definition};
  };
  const games=[game('terminal',0,1),game('limit',0,0),game('illegal',9,0),game('initially_terminal',0,1,1)];
  const bundle=bundleAgent(file,here);
  // Build the step adapter, but do not ask the host to consume a nonzero step
  // budget in a world which can finish without accepting a step.
  write(cfg,plan({games,arms:[{id:'counter',method:'custom',agentFile:file}],
    budgetUnit:'steps',replicates:1,checkpoints:[0,1],validationEpisodes:1,testEpisodes:1}));
  await invoke('run',cfg,out,'--until','0','--bend',bend);
  const api=(await import(new URL('file:'+path.join(out,'code/backend.mjs')).href)).default;
  const init={$:'Counts',learns:0,finishes:0,reason:0};
  for (const [i,g] of games.entries()){
    const name=symbol(g.definition)+'_'+bundle.entry;
    for(const mode of ['Train','Evaluate']){
      const tag={$:mode}, expected=mode==='Evaluate'?init:{...init,learns:[1,3,0,0][i],finishes:1,reason:[1,2,3,1][i]};
      assert.deepEqual(api[name](tag,init,11,3).model,expected);
      assert.deepEqual(api['trace_'+name](tag,init,11,3).report.model,expected);
      let seg=api['segment_'+name](tag,1,api['begin_'+name](init,11,3));
      if(i===1) assert.equal(seg.model.finishes,0);
      seg=api['segment_'+name](tag,3,seg.cursor);
      assert.deepEqual(seg.model,expected);
      assert.deepEqual(seg.finished.value.model,expected);
      const repeated=api['segment_'+name](tag,10,seg.cursor);
      assert.deepEqual(repeated.model,expected);
    }
  }
  const name=symbol(games[1].definition)+'_'+bundle.entry;
  assert.deepEqual(api[name]({$:'Train'},init,11,0).model,{...init,finishes:1,reason:2});
});

test('contextual learner sees the source legal actions and resumes its exact policy snapshot',compilerTest,async t=>{
  const dir=directory(t),file=path.join(dir,'plan.json'),paused=path.join(dir,'paused'),whole=path.join(dir,'whole');
  const edge=(id,to,reward)=>({id,outcomes:[{to,reward,weight:1}]});
  const game={id:'context',limit:2,definition:{schema:1,initial:[{to:10,weight:1}],states:[
    {id:10,actions:[edge(3,20,1),edge(7,20,1)]},{id:20,actions:[edge(9,30,4)]},{id:30,actions:[]}]}};
  write(file,plan({budgetUnit:'steps',games:[game],arms:[{id:'rf',method:'custom',agentFile:path.join(here,'agents','reinforce.bend'),parameters:{alpha:1,beta:.5,gamma:.5}}],replicates:1,checkpoints:[0,1,2],validationEpisodes:1,testEpisodes:1}));
  await invoke('run',file,paused,'--bend',bend,'--until','1');
  const cp=(root,n)=>read(path.join(root,'trials','context','rf','0',n+'.json')).body.model;
  const frozen=cp(paused,1),first=frozen.history.head;
  assert.equal(frozen.logits.$,'Nil');assert.equal(first.s,10);
  assert.deepEqual([first.policy.head.a,first.policy.tail.head.a],[3,7]);
  assert.deepEqual([first.policy.head.p,first.policy.tail.head.p],[.5,.5]);
  await execute(process.execPath,[path.join(paused,'code','experiment.mjs'),'resume',paused]);
  await invoke('run',file,whole,'--bend',bend);
  const final=cp(paused,2);assert.equal(final.history.$,'Nil');assert.equal(final.power,1);
  assert.deepEqual(final,cp(whole,2));
  const replay=JSON.parse((await invoke('replay',paused,'context','rf','0','2','test','0')).stdout);
  assert.equal(replay.initialModel,replay.finalModel);assert.equal(replay.score,5);
});
