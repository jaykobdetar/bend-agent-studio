import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {kartWorld, courses, decode as physical, advance} from '../../../worlds/challenges/apex-kart/kart.mjs';

// Entire tracks are fixed before training; no track index is in an observation.
export const mirror=road=>road.replace(/[lrLR]/g,x=>({l:'r',r:'l',L:'R',R:'L'})[x]);
const mirrored=xs=>xs.flatMap(road=>[road,mirror(road)]);
export const trainRoads=mirrored(['..l..R...','.L...r..','....r..L..','.r..L.r...']);
export const heldoutTracks={
  quarry:courses['kart-sprint'].road,
  'quarry-mirror':mirror(courses['kart-sprint'].road),
  'shifted-pair':'..r.L....',
  'shifted-mirror':mirror('..r.L....')
};
export const startLanes=[0,2];
export const actions=[0,1,2,3,4];
const code='.lrLR';
const pack=(remaining,lane,speed,preview)=>1+((remaining-1)*9+lane*3+speed-1)*125+
  [...preview.padEnd(3,'.')].reduce((s,ch,i)=>s+code.indexOf(ch)*5**i,0);
export function peek(road,{distance,lane,speed}) {
  return pack(road.length-distance,lane,speed,road.slice(distance,distance+3));
}
export function sensors(obs){
  if(obs===0)return null;
  let n=obs-1,p=n%125; n=Math.floor(n/125);
  let remaining=Math.floor(n/9)+1;
  const preview=[0,1,2].map(i=>code[Math.floor(p/5**i)%5]).join('').slice(0,remaining);
  return {remaining,lane:Math.floor(n/3)%3,speed:n%3+1,preview};
}
export function sensorWorld(roads){
  const initial=[],states=[];
  for(const road of roads){
    const w=kartWorld({road,starts:startLanes}),base=states.length;
    for(const s of w.initial)initial.push({to:base+s.to,weight:s.weight});
    for(const state of w.states)states.push({
      id:base+state.id,observation:state.observation?peek(road,physical(state.observation)):0,
      actions:state.actions.map(a=>({id:a.id,outcomes:a.outcomes.map(o=>({...o,to:base+o.to}))}))
    });
  }
  return {schema:1,initial,states};
}
// One-step immediate-reward rule. Nothing beyond the visible next three cells;
// ties use real action order. This is a strong short-sighted diagnostic, not a target.
export function greedy(obs) {
  const {lane,speed,preview}=sensors(obs);
  let choice=0,best=-Infinity;
  for(const a of actions){
    const r=advance(preview,{distance:0,lane,speed},a).reward;
    if(r>best){best=r;choice=a;}
  }
  return choice;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw Error('usage: node design.mjs <new directory>');
  const absolute=path.resolve(process.argv[2]);fs.mkdirSync(absolute,{recursive:false});
  const file=(id,roads)=>{
    let filename=id+'.json';fs.writeFileSync(path.join(absolute,filename),JSON.stringify(sensorWorld(roads))+'\n',{flag:'wx'});
    return {id,file:filename,limit:Math.max(...roads.map(s=>s.length))};
  };
  const games=[file('practice-suite',trainRoads)];
  for(const [id,road] of Object.entries(heldoutTracks))file(id,[road]);
  const agent=path.join(path.dirname(fileURLToPath(import.meta.url)),'kart_features.bend');
  const p={schema:1,name:'kart-public-preview',games,
    arms:[
      {id:'tabular',method:'q_learning',alpha:.25,epsilon:.25,gamma:1},
      {id:'shared',method:'custom',agentFile:path.relative(absolute,agent)}
    ],replicates:8,budgetUnit:'steps',maxTrainEpisodes:70000,
    checkpoints:[0,1024,4096,16384,65536],validationEpisodes:32,testEpisodes:64,
    seeds:{train:987000000,validation:1953000000,test:3167000000,stride:100000}
  };
  fs.writeFileSync(path.join(absolute,'plan.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
}
