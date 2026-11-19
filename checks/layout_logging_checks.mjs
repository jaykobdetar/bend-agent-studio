import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compilerTest} from './support.mjs';
import {seeded,finite} from './seeded_properties.mjs';
import {bendSource,buckets,worldDefinition} from '../core/finite_world.mjs';
import {packedSource} from '../core/packed_world.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const words=2**32, max=words-1, bend=process.env.BEND??'bend';
function scratch(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bend-laws-check-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const file of fs.readdirSync(path.join(root,'core')).filter(n=>n.endsWith('.bend')))
    fs.copyFileSync(path.join(root,'core',file),path.join(dir,file));
  return dir;
}
async function executable(dir,name,text) {
  const input=path.join(dir,name+'.bend'), js=path.join(dir,name+'.mjs');
  fs.writeFileSync(input,text);
  execFileSync(bend,[input,'-o',js],{env:{...process.env,BEND_NO_TELEMETRY:'1'},timeout:30000});
  return (await import(pathToFileURL(js))).default;
}
function probeWords(distribution) {
  const total=distribution.reduce((n,x)=>n+BigInt(x.weight),0n);
  let sum=0n;
  const probes=new Set([0,max]);
  for(const x of distribution) {
    const cut=Number((sum+=BigInt(x.weight))*BigInt(words)/total);
    if(cut>0) probes.add(cut-1);
    if(cut<words) probes.add(cut);
  }
  // Together these include a sample on each side of every possible outcome
  // boundary. No assumption is made about how production code computes them.
  return probes;
}
test('same generated worlds agree directly between compiled packed and literal lookups',compilerTest,async t=>{
  const dir=scratch(t), random=seeded(0x807802ca);
  for(let i=0;i<8;i++) {
    const raw=finite(random);
    // Mix contiguous and sparse IDs in non-sorted input order, including U32_MAX.
    const ids=new Map(raw.states.map((s,j)=>[s.id,j<2?j:j===2?max:random(1<<24)+((j+1)<<24)]));
    for(const x of raw.initial) x.to=ids.get(x.to);
    for(const s of raw.states) {
      s.id=ids.get(s.id);
      for(const action of s.actions) for(const x of action.outcomes) x.to=ids.get(x.to);
    }
    raw.states.reverse();
    const w=worldDefinition(raw);
    const literal=await executable(dir,'literal'+i,bendSource(w));
    const packed=await executable(dir,'packed'+i,packedSource(w,buckets));
    assert.notEqual(bendSource(w),packedSource(w,buckets));
    const addresses=[...w.states.map(s=>s.id),0x80000100];
    for(const state of addresses) {
      const where=`world ${i}, state ${state}`;
      assert.deepEqual(packed.view(state),literal.view(state),where+' view');
      assert.deepEqual(packed.step(state,max,max),literal.step(state,max,max),where+' missing action');
      for(const a of w.states.find(s=>s.id===state)?.actions??[])
        for(const word of probeWords(a.outcomes))
          assert.deepEqual(packed.step(state,a.id,word),literal.step(state,a.id,word),
            `${where}, action ${a.id}, word ${word}`);
    }
    for(const obs of [0,1,2,3,max])
      assert.equal(packed.rank(obs),literal.rank(obs),`world ${i}, observation rank ${obs}`);
    for(let j=0;j<256;j++) {
      const word=random(words);
      assert.equal(packed.reset(word),literal.reset(word),`world ${i}, reset seed ${word}`);
    }
  }
});

test('compiled logging bucket counts partition every 16-bit draw for sampled legal lists',compilerTest,async t=>{
  const api=await executable(scratch(t),'logging',`
import Base
import ./logged.bend as L

def choose(actions: List<&2,U32>, preferred: U32, buckets: U32, word: U32) -> U32:
  L.choose(actions,preferred,buckets,word)

def count(index: U32, size: U32, buckets: U32, preferred: Bool) -> U32:
  L.count(index,size,buckets,preferred)
`.trimStart());
  const random=seeded(0xbbeda028);
  for(let i=0;i<24;i++) {
    const size=i<4?1:2+random(18), winner=random(size);
    const bands=[0,1,65535,65536,random(65537),random(65537)];
    const count=bands[i%bands.length], ids=Array.from({length:size},(_,k)=>(random(1<<24)+k*(1<<24))>>>0);
    const list=ids.reduceRight((tail,head)=>({$:'Con',head,tail}),{$:'Nil'});
    const observed=new Map(ids.map(id=>[id,0]));
    for(let draw=0;draw<65536;draw++) {
      // High bits do not affect the 16-bit choice domain.
      const word=(0xca5e0000+draw)>>>0;
      const action=api.choose(list,ids[winner],count,word);
      assert.ok(observed.has(action),`case ${i}, draw ${draw}, illegal action ${action}`);
      observed.set(action,observed.get(action)+1);
    }
    const actual=ids.map((_id,k)=>api.count(k,size,count,k===winner));
    assert.deepEqual(actual,ids.map(id=>observed.get(id)),`case ${i}, size ${size}, exploration buckets ${count}`);
    assert.equal(actual.reduce((n,x)=>n+x,0),65536);
  }
});

test('both compiled completion hooks agree with direct episodes across seeded paused runs',compilerTest,async t=>{
  const source=fs.readFileSync(path.join(root,'checks','hook_split_fixture.bend'),'utf8');
  const api=await executable(scratch(t),'hook_split',source);
  const random=seeded(0x9eadc08);
  for(const name of ['finishing','contextual']) for(const mode of ['Train','Evaluate']) {
    const coverage=new Set();
    for(let i=0;i<72;i++) {
      const rest=random(256), limit=1+random(10), first=random(limit+1);
      const terminal=i%4===0?0:i%4===1?Math.floor(limit/2):255;
      const illegal=i%4===2?Math.floor(limit/2):255;
      const seed=(rest<<24 | illegal<<16 | terminal<<8)>>>0;
      const result=api[name]({$:mode},seed,limit,first,limit-first);
      assert.equal(result.fst.$,'Some');
      assert.deepEqual(result.fst.value,result.snd,`hook ${name}, mode ${mode}, case ${i}, seed ${seed}`);
      coverage.add(result.snd.reason.$);
    }
    assert.deepEqual([...coverage].sort(),['Illegal','Limit','Terminal']);
  }
});
