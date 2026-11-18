import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {oracle,reactiveOracle,worldDefinition} from '../../../finite_world.mjs';
import {memoryWorld} from '../../../memory_world.mjs';
import {cueMemory,probe,rightAction,sizes} from './probes.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7, a+' != '+b);
test('all published probe files, baselines and manifests regenerate byte for byte',()=>{
  execFileSync(process.execPath,[fileURLToPath(new URL('generate.mjs',import.meta.url))]);
  for(const name of Object.keys(sizes)) {
    const url=new URL('../../../experiments/probe-'+name+'.json',import.meta.url);
    const plan=JSON.parse(readFileSync(url));
    assert.deepEqual(plan.games.map(g=>g.id),sizes[name].map(n=>name+'-'+n));
    assert.match(execFileSync(process.execPath,[fileURLToPath(new URL('../../../experiment.mjs',import.meta.url)),
      'validate',fileURLToPath(url)],{encoding:'utf8'}), /8 trials/);
  }
});

test('all 12 finite-horizon oracles agree with independently derived return formulas',()=>{
  for(const [name,values] of Object.entries(sizes)) for(const n of values) {
    const {definition,horizon}=probe(name,n);
    const o=oracle(worldDefinition(definition),horizon);
    const [optimal,uniform]={
      'deep-sea':[0.99,2**-n-0.005],umbrella:[1,0],memory:[1,0],
      discount:[1.25,1.125],bandit:[0.5,1/n-0.5],catch:[1,2/n-1],
    }[name];
    close(o.optimalFullStateReturn,optimal); close(o.uniformReturn,uniform);
  }
});

test('Deep Sea: exactly one of 2^N action strings earns the goal; right costs apply every step',()=>{
  for(const n of sizes['deep-sea']) {
    const w=worldDefinition(probe('deep-sea',n).definition);
    const good=[];
    for(let bits=0;bits<2**n;bits++) {
      let s=w.states[w.initial[0].to],score=0,c=0;
      for(let t=0;t<n;t++) {
        const action=(bits>>t)&1;
        const right=action===rightAction(t,c), won=right && c===n-1;
        const [x]=s.actions[action].outcomes;
        close(x.reward,(won?1:0)-(right?0.01/n:0));
        c=Math.min(n-1,Math.max(0,c+(right?1:-1)));
        s=w.states[x.to]; score+=x.reward;
      }
      assert.equal(s.actions.length,0);
      if(score>0) good.push(bits);
    }
    assert.equal(good.length,1);
    const optimalBits=Array.from({length:n},(_,i)=>(good[0]>>i)&1);
    assert.ok(optimalBits.includes(0) && optimalBits.includes(1));
  }
});

test('umbrella: only first pick matters; later actions agree, intermediate noise has zero mean',()=>{
  for(const n of sizes.umbrella) {
    const w=worldDefinition(probe('umbrella',n).definition);
    for(const [need,start] of w.initial.entries()) for(const a of [0,1]) {
      let s=w.states[start.to];
      for(let t=0;t<n;t++) {
        if(t>0) assert.deepEqual(s.actions[0].outcomes,s.actions[1].outcomes);
        const xs=s.actions[t===0?a:1].outcomes;
        if(t<n-1) {
          assert.deepEqual(xs.map(x=>[x.reward,x.weight]),[[-1,1],[1,1]]);
          assert.equal(xs[0].to,xs[1].to);
        } else assert.equal(xs[0].reward,a===need?1:-1);
        s=w.states[xs[0].to];
      }
      assert.equal(s.actions.length,0);
    }
  }
});

test('memory: no cue leaks, a one-bit public memory machine removes the reactive gap',()=>{
  for(const n of sizes.memory) {
    const w=worldDefinition(probe('memory',n).definition);
    const base=reactiveOracle(w,n);
    assert.equal(base.optimalStationaryReactiveReturn,0);
    assert.equal(base.optimalFullStateReturn,1);
    const remembered=memoryWorld(w,cueMemory(n));
    assert.equal(reactiveOracle(remembered,n).optimalStationaryReactiveReturn,1);
  }
});

test('discount chain switches preference with delay while undiscounted ordering is fixed',()=>{
  const fixed=(w,a,gamma)=>{
    let s=w.states[w.initial[0].to], value=0, factor=1;
    while(s.actions.length) {
      const [x]=s.actions[a].outcomes;
      value+=factor*x.reward;factor*=gamma;s=w.states[x.to];a=0;
    }
    return value;
  };
  for(const n of sizes.discount) {
    const w=worldDefinition(probe('discount',n).definition);
    close(fixed(w,0,0.95),1);close(fixed(w,1,0.95),1.25*0.95**(n-1));
    assert.equal(fixed(w,1,0.95)>fixed(w,0,0.95),n===3);
  }
});

test('Catch exposes ball and paddle, clamps both walls; noisy bandit arms keep their binary payouts',()=>{
  for(const width of sizes.catch) {
    const w=worldDefinition(probe('catch',width).definition), seen=new Map();
    assert.equal(w.initial.length,width);
    for(const [ball,x] of w.initial.entries()) {
      assert.equal(x.weight,1);
      for(const first of [-1,0,1]) for(const last of [-1,0,1]) {
        let s=w.states[x.to],p=Math.floor(width/2);
        for(const [t,move] of [first,last].entries()) {
          const key=[t,ball,p].join(':');
          if(seen.has(s.observation)) assert.equal(seen.get(s.observation),key);
          else seen.set(s.observation,key);
          assert.deepEqual(s.actions.map(a=>a.id),[0,1,2]);
          p=Math.min(width-1,Math.max(0,p+move));
          const [out]=s.actions[move+1].outcomes;
          assert.equal(out.reward,t===0?0:p===ball?1:-1);
          s=w.states[out.to];
        }
        assert.equal(s.actions.length,0);
      }
    }
  }
  for(const n of sizes.bandit) {
    const w=worldDefinition(probe('bandit',n).definition);
    const actions=w.states[w.initial[0].to].actions;
    assert.equal(actions.length,n);
    assert.deepEqual(actions.map(a=>a.outcomes.map(x=>[x.reward,x.weight])),Array.from({length:n},(_,i)=>
      [[1,i===n-1?3:1],[-1,i===n-1?1:3]]));
    for(const a of actions) for(const x of a.outcomes) assert.equal(w.states[x.to].actions.length,0);
  }
});
