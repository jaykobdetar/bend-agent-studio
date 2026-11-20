import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {courses, advance, decode, encode, kartWorld, actionLabels} from './kart.mjs';
import {scriptedInput} from './driver.mjs';
import {oracle, symbol, usesPackedWorld, worldDefinition} from '../../../core/finite_world.mjs';
import {knownGridLayouts} from '../../../studio/grid-layouts.mjs';
import {kartActions, kartCaption} from '../../../studio/web/kart-scene.js';

const ok = (a,b) => assert.ok(Math.abs(a-b) < 1e-10, a+' differs from '+b);
const machine = (road, lane, speed, action) => advance(road,{distance:0,lane,speed},action);
test('a tick applies exactly one control before sweeping cells; grip, runoff and finish', () => {
  assert.deepEqual(machine('......',0,2,3), {observation:20,distance:2,lane:0,speed:2,gravel:false,reward:1});
  assert.deepEqual(machine('...L.',1,1,1), {observation:23,distance:2,lane:1,speed:2,gravel:false,reward:1});
  assert.deepEqual(machine('...L.',2,3,2), {observation:26,distance:2,lane:2,speed:2,gravel:false,reward:1});
  assert.deepEqual(machine('.L....',0,2,0), {observation:23,distance:2,lane:1,speed:2,gravel:false,reward:1});
  // Outside, overspeed; two cells reached, no tunneling through the hairpin.
  assert.deepEqual(machine('.L....',2,2,1), {observation:25,distance:2,lane:2,speed:1,gravel:true,reward:-3});
  // A successful first apex pushes the kart out; crossing a second apex tests the changed lane.
  assert.deepEqual(machine('rr...',2,3,0), {observation:19,distance:2,lane:0,speed:1,gravel:true,reward:-3});
  // A hairpin at top speed cannot be saved by choosing the inside line.
  assert.equal(machine('R..',2,3,0).gravel,true);
  assert.deepEqual(machine('.',2,3,1), {observation:0,distance:1,lane:2,speed:3,gravel:false,reward:0});
  // A penalty on the final tile still counts.
  assert.equal(machine('R',2,3,1).reward,-4);
  assert.throws(()=>machine('.',0,1,5),/unknown/);
});
function runPolicy(w, initial, choose) {
  let id=initial.to,total=0,ticks=0;
  for (;w.states[id].actions.length; ++ticks) {
    assert.ok(ticks<128);
    const row=w.states[id], {to,reward}=row.actions.find(a=>a.id===choose(row.observation,ticks)).outcomes[0];
    total+=reward; id=to;
  }
  return {total,ticks};
}
test('sprint hand bound is achieved, and controls demonstrate a real tradeoff on the longer course', () => {
  for (const [id, data] of Object.entries(courses)) {
    const w=worldDefinition(kartWorld(data)); const o=oracle(w,data.road.length);
    const valueWith = allowed => oracle({...w,states:w.states.map(s=>({...s,
      actions:s.actions.filter(a=>allowed.includes(a.id))}))},data.road.length).optimalFullStateReturn;
    // Even on a straight the most distance possible in 3 ticks from speed 1 is 2+3+3=8.
    if (id==='kart-sprint') {
      assert.deepEqual(runPolicy(w,w.initial[0],(_,i)=>[1,3,4,1][i]), {total:5,ticks:4});
      assert.equal(o.optimalFullStateReturn,5); ok(o.uniformReturn,-0.01149184);
      assert.equal(valueWith([0,1,2]),3); assert.equal(usesPackedWorld(w),false);
    } else {
      assert.equal(o.optimalFullStateReturn,16); ok(o.uniformReturn,1.5688984212201817);
      assert.equal(valueWith([0,1,3,4]),15); // removing brakes changes the best race
      assert.equal(valueWith([0,1,2]),14);   // removing steering also changes it
      assert.equal(usesPackedWorld(w),true);
    }
    const results = choose => w.initial.map(start=>runPolicy(w,start,choose).total);
    assert.deepEqual(results(()=>0), w.initial.map(()=>0));
    assert.deepEqual(results(()=>1),id==='kart-sprint'?[1]:[-1,-6]);
    assert.deepEqual(results(obs=>scriptedInput(data.road,obs)), id==='kart-sprint'?[3]:[11,15]);
  }
});
test('reachable states only, reversible public IDs, all legal inputs, terminal and progress', () => {
  assert.equal(decode(0),null);
  for (const [id, data] of Object.entries(courses)) {
    const w=worldDefinition(kartWorld(data)); assert.equal(w.states.length,id==='kart-sprint'?41:169);
    const reachable=new Set(w.initial.map(x=>x.to)); const stack=[...reachable];
    while(stack.length) {
      const state=w.states[stack.pop()];
      if(!state.observation){assert.deepEqual(state.actions,[]); continue;}
      const s=decode(state.observation);assert.equal(encode(s),state.observation);
      assert.deepEqual(state.actions.map(x=>x.id),[0,1,2,3,4]);
      for(const a of state.actions){
        assert.equal(a.outcomes.length,1);
        const {to,reward,weight}=a.outcomes[0], obs=w.states[to].observation,
          delta=(obs ? decode(obs).distance : data.road.length)-s.distance;
        assert.equal(weight,1);assert.ok(delta>=1 && delta<=3);
        assert.ok(reward===delta-1 || reward===delta-5);
        if (!reachable.has(to)) {reachable.add(to);stack.push(to);}
      }
    }
    assert.equal(reachable.size,w.states.length);
  }
  for(const opts of [{road:'',starts:[1]}, {road:'z',starts:[1]}, {road:'.',starts:[2,2]}, {road:'.',starts:[9]}])
    assert.throws(()=>kartWorld(opts));
});
test('regenerate committed fixtures; only matched layouts label model inputs', () => {
  const root=fileURLToPath(new URL('../../../',import.meta.url)), layouts=knownGridLayouts(root);
  execFileSync(process.execPath,[fileURLToPath(new URL('generate.mjs',import.meta.url)),'--check']);
  assert.deepEqual(kartActions,actionLabels);
  assert.equal(kartCaption({renderer:'apex-kart'},1),undefined);
  for (const c of Object.values(courses)) {
    const layout=layouts.get(symbol(kartWorld(c)));
    assert.deepEqual(layout,{renderer:'apex-kart',road:c.road,title:c.title});
    assert.match(kartCaption(layout,encode({distance:0,lane:0,speed:1})),/Left lane, speed 1/);
    assert.match(kartCaption(layout,0),/finished all/);
    assert.equal(kartCaption(layout,c.road.length*9+1),undefined);
    assert.equal(layouts.get(symbol(kartWorld({...c,road:c.road+'r'}))),undefined);
  }
});
