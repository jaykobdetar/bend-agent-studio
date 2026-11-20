// Evaluate only trusted archived policies. Exact evaluation traverses both
// weighted starts on each deterministic test track, with an independent
// stock finite-policy oracle cross-check. No test transitions train the agents.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {trainRoads, heldoutTracks, startLanes, actions, peek, sensors, sensorWorld, greedy, mirror} from './design.mjs';
import {advance, kartWorld, decode} from '../../../worlds/challenges/apex-kart/kart.mjs';
import {archive} from '../../../offline/dataset.mjs';
import {existing, adapterName} from '../../../core/experiment.mjs';
import {policyOracle} from '../../../core/public_oracle.mjs';
import {worldDefinition,oracle} from '../../../core/finite_world.mjs';

const rowsRequested=process.argv[3]==='--rows';
if(process.argv.length!==(rowsRequested?4:3))throw Error('usage: node score.mjs <trusted completed practice run> [--rows]');
const run=path.resolve(process.argv[2]),{manifest,plan,api}=await archive(run);
const game=plan.games[0];assert.equal(plan.games.length,1);assert.equal(game.id,'practice-suite');
assert.deepEqual(game.definition,worldDefinition(sensorWorld(trainRoads)));
assert.equal(plan.replicates,8);
assert.deepEqual(plan.checkpoints,[0,1024,4096,16384,65536]);
assert.deepEqual(plan.arms.map(a=>a.id),['tabular','shared']);
assert.equal(new Set([...trainRoads,...Object.values(heldoutTracks)]).size,trainRoads.length+Object.keys(heldoutTracks).length);
const intList=actions.reduceRight((tail,head)=>({$:'Con',head,tail}),{$:'Nil'});
const terminalMap=new Map();let transitionChecks=0;
function assertPerception(road){
  const other=mirror(road);
  for(const s of kartWorld({road,starts:startLanes}).states){
    if(s.actions.length===0){assert.equal(s.observation,0);continue;}
    const pose=decode(s.observation), obs=peek(road,pose), y=sensors(obs);
    assert.deepEqual(y,{remaining:road.length-pose.distance,lane:pose.lane,speed:pose.speed,
                        preview:road.slice(pose.distance,pose.distance+3)});
    for(const a of actions){
      const t=advance(road,pose,a),
        local=advance(y.preview,{distance:0,lane:pose.lane,speed:pose.speed},a),
        reflected=advance(other,{...pose,lane:2-pose.lane},a===3?4:a===4?3:a);
      assert.equal(t.reward,local.reward);assert.equal(t.gravel,local.gravel);
      assert.equal(t.reward,reflected.reward);assert.equal(t.gravel,reflected.gravel);
      assert.equal(t.distance,reflected.distance);assert.equal(t.lane,2-reflected.lane);assert.equal(t.speed,reflected.speed);
      transitionChecks++;
    }
  }
}
for(const road of [...trainRoads,...Object.values(heldoutTracks)])assertPerception(road);
function suffixes(v){
  const map=new Map();
  for(const s of v.states)if(s.actions.length){
    if(!map.has(s.observation))map.set(s.observation,new Set());
    map.get(s.observation).add(JSON.stringify(s.actions.map(a=>a.outcomes.map(o=>[
      o.reward,v.states[o.to].observation,
    ]))));
  }
  return map;
}
const trainingViews=suffixes(game.definition);
const aliases=[...trainingViews.values()].filter(v=>v.size>1).length;
function drive(road,rule,lane,seen=null){
  let pose={distance:0,lane,speed:1},score=0,ticks=0,gravel=0,unseen=0;
  while(pose.distance<road.length){
    const obs=peek(road,pose),action=rule(obs,actions);
    assert(actions.includes(action));if(seen&&!seen.has(obs))unseen++;
    pose=advance(road,pose,action);score+=pose.reward;ticks++;gravel+=Number(pose.gravel);
    assert(ticks<=road.length);
  }
  assert.equal(score,road.length-ticks-4*gravel);
  return {lane,score,ticks,gravel,unseen};
}
const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
function check(world,road,policy,seen){
  const branch=startLanes.map(l=>drive(road,policy,l,seen));
  const exact=policyOracle(world,road.length,policy);
  assert.equal(exact.terminalProbability,1); assert.equal(exact.expectedReturn,mean(branch.map(x=>x.score)));
  return {mean:exact.expectedReturn,starts:branch};
}
const targets={};
for(const [id,road] of Object.entries(heldoutTracks)){
  const w=worldDefinition(sensorWorld([road]));terminalMap.set(id,w);
  const previews=suffixes(w);
  const ub=oracle(w,road.length).optimalFullStateReturn;
  const scripted=check(w,road,greedy);
  assert(scripted.mean<=ub);
  targets[id]={road,states:w.states.length,oracle:ub,scripted,
    distinctPublicViews:previews.size,viewsPresentInPractice:[...previews.keys()].filter(x=>trainingViews.has(x)).length};
}
function tableViews(model){
  if(model.values.$==='Nil')return new Set();
  assert.equal(model.values.head.$,'Indexed');
  const nodes=[model.values.head.tree],seen=new Set();
  while(nodes.length){
    const x=nodes.pop();if(x.$==='Vacant')continue;
    assert.equal(x.$,'Node');seen.add(x.s);nodes.push(x.lo,x.hi);
  }
  return seen;
}
const rows=[];
for(let rep=0;rep<plan.replicates;rep++){
  // Track what tabular actually experienced as a separate diagnostic and
  // see how often either chosen trajectory visits such public views.
  let q=plan.arms[0],parent=null;const visits=new Map();
  for(const budget of plan.checkpoints){
    const cp=existing(run,manifest.hash,{game,arm:q,rep},budget,parent);assert(cp);parent=cp.hash;
    visits.set(budget,tableViews(cp.body.model));
  }
  for(const arm of plan.arms){
    const native=api['preferred_'+adapterName(game,arm)]; parent=null;
    for(const budget of plan.checkpoints){
      const cp=existing(run,manifest.hash,{game,arm,rep},budget,parent);assert(cp);parent=cp.hash;
      const {body}=cp;assert.equal(body.train.steps+(body.partial?.steps??0),budget);assert.equal(body.train.illegal,0);
      const policy=(obs,as)=>{assert.deepEqual(as,actions);return native(body.model,obs,intList);};
      const held={};
      for(const [id,road] of Object.entries(heldoutTracks))held[id]=check(terminalMap.get(id),road,policy,visits.get(budget));
      for(const [id,r] of Object.entries(held))assert(r.mean<=targets[id].oracle);
      rows.push({rep,arm:arm.id,budget,held,trainingObsForTabular:visits.get(budget).size,
        validationMean:body.validation.mean,hash:cp.hash});
    }
  }
}
const report={};
for(const budget of plan.checkpoints){
  const collection=(arm,where)=>rows.filter(r=>r.budget===budget&&r.arm===arm).map(r=>
    where==='all'?mean(Object.values(r.held).map(x=>x.mean)):r.held[where].mean);
  const summary={};
  for(const id of [...Object.keys(heldoutTracks),'all']){
    const tab=collection('tabular',id),linear=collection('shared',id);
    const d=linear.map((x,i)=>x-tab[i]),gain=mean(d),spread=2.3646242510103*Math.sqrt(d.reduce((s,x)=>s+(x-gain)**2,0)/7/8);
    summary[id]={tabular:mean(tab),shared:mean(linear),gain,interval:[gain-spread,gain+spread],
      qBetter:d.filter(x=>x<0).length,linearBetter:d.filter(x=>x>0).length};
  }
  report[budget]=summary;
}
const final={};
for(const arm of plan.arms){
  const fits=rows.filter(r=>r.arm===arm.id&&r.budget===plan.checkpoints.at(-1));
  const starts=fits.flatMap(r=>Object.values(r.held).flatMap(t=>t.starts));
  final[arm.id]={validation:mean(fits.map(r=>r.validationMean)),starts:starts.length,
    ticks:starts.reduce((s,r)=>s+r.ticks,0),gravel:starts.reduce((s,r)=>s+r.gravel,0),
    ticksNotObservedByPairedTabular:starts.reduce((s,r)=>s+r.unseen,0)};
}
console.log(JSON.stringify({trainRoads,heldoutTracks,transitionChecks,trainingUniqueViews:trainingViews.size,
  aliases,targets,report,final,...(rowsRequested?{rows}:{})},null,2));
