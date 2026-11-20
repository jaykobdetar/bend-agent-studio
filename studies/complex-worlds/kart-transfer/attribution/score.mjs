import assert from 'node:assert/strict';
import path from 'node:path';
import {trainRoads,actions,startLanes,sensorWorld,peek,greedy,mirror} from '../design.mjs';
import {tracks,stages,ids} from './design.mjs';
import {advance,decode,kartWorld} from '../../../../worlds/challenges/apex-kart/kart.mjs';
import {archive} from '../../../../offline/dataset.mjs';
import {existing,adapterName} from '../../../../core/experiment.mjs';
import {worldDefinition,oracle} from '../../../../core/finite_world.mjs';
import {policyOracle} from '../../../../core/public_oracle.mjs';

const detailed=process.argv[3]==='--rows';
if(process.argv.length!==(detailed?4:3))throw Error('usage: node score.mjs <trusted run> [--rows]');
const run=path.resolve(process.argv[2]), {api,manifest,plan}=await archive(run);
assert.equal(plan.name,'kart-reflection-attribution');
assert.deepEqual(plan.arms.map(a=>a.id),ids);
assert.deepEqual(plan.checkpoints,stages);
assert.equal(plan.replicates,8);assert.equal(plan.games.length,1);
const game=plan.games[0];assert.deepEqual(game.definition,worldDefinition(sensorWorld(trainRoads)));
const mean=xs=>xs.reduce((s,a)=>s+a,0)/xs.length;
const bendList=actions.reduceRight((s,a)=>({$:'Con',head:a,tail:s}),{$:'Nil'});
const pairedObjects=Object.entries(tracks).flatMap(([group,t])=>Object.entries(t).map(([id,road])=>({id,group,road})));
assert.equal(new Set([...trainRoads,...pairedObjects.map(a=>a.road)]).size,trainRoads.length+pairedObjects.length);
const groupTracks=[...trainRoads,...pairedObjects.map(t=>t.road)];
const turn=a=>a===3?4:a===4?3:a;
const mirrorContexts=new Map();
let physicalParity=0,scriptPreviewParity=0,modelMirrorChecks=0;
for(const road of groupTracks)for(const row of kartWorld({road,starts:startLanes}).states){
  if(!row.observation)continue;
  const pose=decode(row.observation), mirrored={...pose,lane:2-pose.lane},
    other=mirror(road),preview=road.slice(pose.distance,pose.distance+3);
  if (/[lrLR]/.test(preview))mirrorContexts.set(peek(road,pose)+':'+peek(other,mirrored),[peek(road,pose),peek(other,mirrored)]);
  for(const a of actions){
    const x=advance(road,pose,a), m=advance(other,mirrored,turn(a));
    assert.equal(m.distance,x.distance);assert.equal(m.lane,2-x.lane);assert.equal(m.speed,x.speed);
    assert.equal(m.reward,x.reward);assert.equal(m.gravel,x.gravel);physicalParity++;
    const local=advance(preview,{distance:0,lane:pose.lane,speed:pose.speed},a);
    assert.equal(x.reward,local.reward);scriptPreviewParity++;
  }
}
function branch(road,start,policy){
  let s={distance:0,lane:start,speed:1},score=0,ticks=0,gravel=0;
  while(s.distance<road.length){
    const a=policy(peek(road,s),actions);assert(actions.includes(a));
    s=advance(road,s,a);score+=s.reward;++ticks;gravel+=Number(s.gravel);
    assert(ticks<=road.length);
  }
  assert.equal(score,road.length-ticks-4*gravel);
  return {start,score,ticks,gravel};
}
function scoreWorld(world,roads,policy){
  const all=roads.flatMap(road=>startLanes.map(s=>branch(road,s,policy))),
    upperH=Math.max(...roads.map(s=>s.length)),p=policyOracle(world,upperH,policy);
  assert.equal(p.terminalProbability,1);assert.equal(p.expectedReturn,mean(all.map(x=>x.score)));
  return {value:p.expectedReturn,gravel:all.reduce((s,r)=>s+r.gravel,0),ticks:all.reduce((s,r)=>s+r.ticks,0),branchCount:all.length};
}
const bounds={},targetWorlds=new Map(), practice=game.definition;
for(const a of pairedObjects){
  const world=worldDefinition(sensorWorld([a.road]));targetWorlds.set(a.id,world);
  bounds[a.id]={road:a.road,group:a.group,greedy:scoreWorld(world,[a.road],greedy),
    upper:oracle(world,a.road.length).optimalFullStateReturn};
}
const rows=[];
for(let rep=0;rep<plan.replicates;rep++)for(const arm of plan.arms){
  let parent=null;const preferred=api['preferred_'+adapterName(game,arm)];
  for(const n of stages){
    const cp=existing(run,manifest.hash,{game,arm,rep},n,parent);assert(cp);parent=cp.hash;
    assert.equal(cp.body.train.steps+(cp.body.partial?.steps??0),n);
    assert.equal(cp.body.train.illegal,0);const policy=(s,l)=>{assert.deepEqual(l,actions);return preferred(cp.body.model,s,bendList)};
    if(n===stages.at(-1)&&arm.id.endsWith('reflected')){
      for(const [a,b] of mirrorContexts.values()){
        assert.equal(turn(policy(a,actions)),policy(b,actions));modelMirrorChecks++;
      }
    }
    const held={};
    for(const {id,road} of pairedObjects){
      held[id]=scoreWorld(targetWorlds.get(id),[road],policy);assert(held[id].value<=bounds[id].upper);
    }
    rows.push({rep,arm:arm.id,budget:n,source:cp.hash,held,practice:scoreWorld(practice,trainRoads,policy),
               validation:cp.body.validation.mean});
  }
}
function paired(xs){
  assert.equal(xs.length,8);
  const estimate=mean(xs), w=2.3646242510103*Math.sqrt(xs.reduce((s,x)=>s+(x-estimate)**2,0)/7/8);
  return {estimate,interval:[estimate-w,estimate+w],wins:xs.filter(x=>x>0).length,ties:xs.filter(x=>x===0).length};
}
const contrastDefs=[
  ['poolingWithoutReflection',[-1,0,1,0]],
  ['poolingWithReflection',[0,-1,0,1]],
  ['reflectionForTabular',[-1,1,0,0]],
  ['reflectionForLinear',[0,0,-1,1]],
  ['interaction',[1,-1,-1,1]],
  ['bundle',[-1,0,0,1]]
];
const curves={};
for(const budget of stages){
  let out=curves[budget]={};
  for(const key of [...Object.keys(tracks),'practice']){
    const lookup=r=>key==='practice'?[r.practice]: Object.keys(tracks[key]).map(i=>r.held[i]);
    const armRows=ids.map(id=>rows.filter(r=>r.budget===budget&&r.arm===id));
    const values=armRows.map(rs=>rs.map((r,rep)=>{assert.equal(r.rep,rep);return mean(lookup(r).map(x=>x.value));}));
    const contrasts={};
    for(const [name,c] of contrastDefs)
      contrasts[name]=paired(values[0].map((_,i)=>c.reduce((sum,w,j)=>sum+w*values[j][i],0)));
    const armMeans=Object.fromEntries(ids.map((a,i)=>[a,mean(values[i])]));
    const gravel=Object.fromEntries(ids.map((a,i)=>[a,armRows[i].reduce((s,r)=>s+lookup(r).reduce((t,x)=>t+x.gravel,0),0)]));
    out[key]={armMeans,contrasts,gravel};
  }
}
console.log(JSON.stringify({layouts:tracks,bounds,physicalParity,scriptPreviewParity,modelMirrorChecks,curves,...(detailed?{rows}:{})},null,2));
