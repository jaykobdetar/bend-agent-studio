import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {trainRoads, heldoutTracks, sensorWorld, mirror} from '../design.mjs';

const road='..Lr.l...';
export const tracks={diagnostic:heldoutTracks,reserved:{'close-triple':road,'close-triple-mirror':mirror(road)}};
export const stages=[0,1024,4096,16384,65536];
export const ids=['table-raw','table-reflected','linear-raw','linear-reflected'];
const dir=path.dirname(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw Error('usage: node design.mjs <new directory>');
  const root=path.resolve(process.argv[2]);fs.mkdirSync(root);
  const save=(name,value)=>fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const shape=(g,file)=>({id:g,file:file+'.json',limit:Math.max(...trainRoads.map(s=>s.length))});
  const relative=f=>path.relative(root,path.resolve(dir,f));
  save('practice-suite',sensorWorld(trainRoads));
  const plan={schema:1,name:'kart-reflection-attribution',games:[shape('practice-suite','practice-suite')],arms:[
    {id:ids[0],method:'q_learning',alpha:.25,epsilon:.25,gamma:1},
    {id:ids[1],method:'custom',agentFile:relative('tabular_reflected.bend')},
    {id:ids[2],method:'custom',agentFile:relative('linear_raw.bend')},
    {id:ids[3],method:'custom',agentFile:relative('../kart_features.bend')}
  ],replicates:8,budgetUnit:'steps',maxTrainEpisodes:70000,checkpoints:stages,validationEpisodes:32,testEpisodes:64,
    seeds:{train:1106000000,validation:2027000000,test:3276000000,stride:100000}};
  save('plan',plan);
  const parity=structuredClone(plan);
  parity.name='kart-wrapper-parity';
  parity.arms=parity.arms.slice(0,2);
  parity.arms[1].id='table-wrapper-no-reflection';parity.arms[1].parameters={reflect:0};
  parity.replicates=1;parity.checkpoints=[0,1024,8192];parity.maxTrainEpisodes=9000;
  parity.seeds={train:1415000000,validation:2219000000,test:3712000000,stride:100000};
  save('parity',parity);
  save('locked-layouts',{practice:trainRoads,...tracks});
}
