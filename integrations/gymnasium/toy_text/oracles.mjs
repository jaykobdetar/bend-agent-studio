// Uses the actual quantized Bend kernel, not the ideal rational probabilities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {oracle, worldDefinition} from '../../../finite_world.mjs';
const dir=new URL('../../../worlds/benchmarks/toy-text/',import.meta.url);
const headings={'lake4-dry':100,'lake4-slip':100,'lake8-dry':200,'lake8-slip':200,taxi:200,cliff4x12:200,blackjack:32};
const results={};
for(const [name,h] of Object.entries(headings)){
  const world=worldDefinition(JSON.parse(fs.readFileSync(new URL(name+'.json',dir))));
  const o=oracle(world,h);
  results[name]={horizon:h,optimal:o.optimalFullStateReturn,uniform:o.uniformReturn};
}
const file=new URL('baselines.json',import.meta.url);
if(process.argv[2]==='--write') fs.writeFileSync(file,JSON.stringify(results,null,2)+'\n');
else {
  const expected=JSON.parse(fs.readFileSync(file));
  assert.deepEqual(Object.keys(results),Object.keys(expected));
  for(const [k,r] of Object.entries(results)) for(const field of Object.keys(r))
    assert.ok(Math.abs(r[field]-expected[k][field])<1e-10,k+' '+field);
}
console.log(JSON.stringify(results,null,2));
