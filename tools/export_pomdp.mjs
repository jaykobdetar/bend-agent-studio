// Sparse Cassandra model. Bend's normalized world uses discrete U32 buckets.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {worldDefinition,buckets} from '../core/finite_world.mjs';

export function exportPomdp(input,{discount=.95,illegalPenalty=-1000000}={}) {
  if(!Number.isFinite(discount)||discount<0||discount>1)throw Error('discount must be in [0,1]');
  if(!Number.isFinite(illegalPenalty)||illegalPenalty>=0)throw Error('illegal penalty must be finite and negative');
  const w=worldDefinition(input),states=w.states;
  const uniq=xs=>[...new Set(xs)].sort((a,b)=>a-b);
  const actions=uniq(states.flatMap(s=>s.actions.map(a=>a.id))).map(i=>'a'+i);
  if(!actions.length)actions.push('idle');
  const obs=uniq(states.map(s=>s.observation)).map(i=>'o'+i);
  const start=new Map();for(const x of buckets(w.initial))start.set(x.to,(start.get(x.to)||0)+x.probability);
  const lines=['discount: '+discount,'values: reward','states: '+states.map(s=>'s'+s.id).concat('sink').join(' '),
    'actions: '+actions.join(' '),'observations: '+obs.concat('osink').join(' '),'start: '+states.map(s=>start.get(s.id)||0).concat(0).join(' ')];
  for(const s of states){
    const from='s'+s.id;lines.push('O: * : '+from+' : o'+s.observation+' 1');
    for(const a of actions){
      const prefix=a+' : '+from+' : ', legal=s.actions.find(x=>'a'+x.id===a);
      if(!legal){const dest=s.actions.length?'sink':from;lines.push('T: '+prefix+dest+' 1');
        if(s.actions.length)lines.push('R: '+prefix+'sink : * '+illegalPenalty);continue;}
      const grouped=new Map();
      for(const x of buckets(legal.outcomes)){if(!x.probability)continue;
        const row=grouped.get(x.to)||{p:0,r:0};row.p+=x.probability;row.r+=x.probability*x.reward;grouped.set(x.to,row);}
      for(const [id,{p,r}] of grouped){lines.push('T: '+prefix+'s'+id+' '+p);if(r)lines.push('R: '+prefix+'s'+id+' : * '+r/p);}
    }
  }
  lines.push('T: * : sink : sink 1','O: * : sink : osink 1');return lines.join('\n')+'\n';
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const [src,dest,...flags]=process.argv.slice(2),opts={};
    if(!src||!dest)throw Error('usage: node tools/export_pomdp.mjs WORLD OUTPUT [--discount G] [--illegal-penalty R]');
    for(let i=0;i<flags.length;i+=2){const k=({'--discount':'discount','--illegal-penalty':'illegalPenalty'})[flags[i]];
      if(!k||!flags[i+1]||Object.hasOwn(opts,k))throw Error('invalid option: '+flags[i]);opts[k]=Number(flags[i+1]);}
    fs.writeFileSync(dest,exportPomdp(JSON.parse(fs.readFileSync(src,'utf8')),opts),{flag:'wx'});
  }catch(e){console.error(e.message);process.exitCode=1;}
}
