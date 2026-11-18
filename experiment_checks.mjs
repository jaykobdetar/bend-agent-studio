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
