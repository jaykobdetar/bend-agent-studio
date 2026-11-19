import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {oracle,worldDefinition} from '../../../core/finite_world.mjs';
import {probe,sizes} from './probes.mjs';

const mode=process.argv[2]??'--check';
if(!['--write','--check'].includes(mode)) throw Error('use --write or --check');
function persist(url,data) {
  if(mode==='--write') fs.writeFileSync(url,data);
  else if(fs.readFileSync(url,'utf8')!==data) throw Error('regeneration differs: '+url.pathname.split('/').pop());
}
const baselines={}, layouts={};
for(const [name,values] of Object.entries(sizes)) {
  const games=values.map(size=>{
    const {definition,horizon,layout}=probe(name,size,true);
    const id=name+'-'+size, o=oracle(worldDefinition(definition),horizon);
    baselines[id]={horizon,optimal:o.optimalFullStateReturn,uniform:o.uniformReturn};
    // Keep one readable line per state, not a many-thousand-line inline plan.
    const f=id+'.json';
    const header=JSON.stringify({schema:1,initial:definition.initial}).slice(0,-1);
    const data=header+',"states":[\n'+definition.states.map(s=>JSON.stringify(s)).join(',\n')+'\n]}\n';
    persist(new URL(f,import.meta.url),data);
    if(layout) layouts[f]={sha256:createHash('sha256').update(data).digest('hex'),...layout};
    return {id,file:'../worlds/benchmarks/probes/'+f,limit:horizon};
  });
  const plan={schema:1,name:'probe-'+name,games,arms:[{id:'random',method:'random'},{id:'q',method:'q_learning'}],
    replicates:2,checkpoints:[0,8,32],validationEpisodes:8,testEpisodes:8,
    seeds:{train:60000000,validation:1600000000,test:2600000000,stride:10000}};
  persist(new URL('../../../experiments/probe-'+name+'.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
}
persist(new URL('baselines.json',import.meta.url),JSON.stringify(baselines,null,2)+'\n');
persist(new URL('layouts.json',import.meta.url),JSON.stringify(layouts,null,2)+'\n');
console.log('Verified 12 probe worlds and baselines, 6 two-size plans.');
