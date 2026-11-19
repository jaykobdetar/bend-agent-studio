// Usage: node benchmarks/tabular-timing.mjs LIST_RUN TREE_RUN
// Compare trusted, locally generated planning-budget archives with a Q arm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {symbol} from '../core/finite_world.mjs';

const runs=process.argv.slice(2);
if (runs.length!==2) throw Error('provide list and tree planning-budget run directories');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const name=symbol(read(new URL('../worlds/detour.json',import.meta.url)));
const inputs=await Promise.all(runs.map(async root=>{
  const url=pathToFileURL(path.resolve(root,'code/backend.mjs'));
  const api=(await import(url.href)).default;
  const model=read(path.join(root,'trials/detour/q/0/0.json')).body.model;
  if (typeof api[name]!=='function') throw Error('archive lacks matching detour world');
  return {episode:api[name],model};
}));
const times=[[],[]]; let reference;
for(let round=-2;round<8;round++){
  for(const i of (round%2?[1,0]:[0,1])){
    let {episode,model}=inputs[i]; const scores=[];
    const start=performance.now();
    for(let j=0;j<700;j++){
      const r=episode({$:'Train'},model,91000000+j,40);
      model=r.model;scores.push(r.score);
    }
    const elapsed=performance.now()-start;
    if (!reference) reference=scores;
    else assert.deepEqual(scores,reference,'episode score divergence');
    if(round>=0) times[i].push(elapsed);
  }
}
const median=a=>{const v=[...a].sort((x,y)=>x-y);return (v[3]+v[4])/2};
const medians=times.map(median);
console.log(JSON.stringify({node:process.version,game:'detour',arm:'q',episodes:700,
  samplesMs:times,medianMs:medians,speedup:medians[0]/medians[1]},null,2));
