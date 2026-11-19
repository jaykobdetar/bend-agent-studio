import assert from 'node:assert/strict';
import fs from 'node:fs';
import {worldDefinition} from '../core/finite_world.mjs';
import {memoryWorld} from '../tools/memory_world.mjs';
import {policyOracle} from '../core/public_oracle.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL('../worlds/'+name+'.json',import.meta.url),'utf8'));
const tiger=worldDefinition(read('tiger'));
for (const name of ['sound','clock','evidence']) {
  const rebuilt=memoryWorld(tiger,read('tiger-'+name+'-rules'),{taskHorizon:8});
  assert.deepEqual(rebuilt,read('tiger-'+name+'-h8'));
  assert.equal(policyOracle(rebuilt,12,()=>0).expectedReturn,-8);
  assert.equal(policyOracle(rebuilt,12,()=>0).terminalProbability,1);
}
const spec=read('reward-memory-rules'),clue=worldDefinition(read('reward-cue'));
const product=memoryWorld(clue,spec);
assert.equal(policyOracle(product,2,(o,legal)=>legal.length===1?legal[0]:o>99?2:1).expectedReturn,2.5);
assert.throws(()=>memoryWorld(clue,spec,{maxStates:1}),/budget/);
assert.throws(()=>memoryWorld(clue,{...spec,rules:[{reward:.1,to:1},{reward:Math.fround(.1),to:0}]}),/overlap/);
assert.deepEqual(memoryWorld(clue,spec,{taskHorizon:0}).states.flatMap(s=>s.actions),[]);
console.log('Memory products, finite task deadlines and rule conflicts passed.');
