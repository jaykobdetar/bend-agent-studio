import {unseal,existing} from '../experiment.mjs';
import {canonical,digest} from '../experiment_config.mjs';
import path from 'node:path';
try {
 const [run,g,a,r,n,full]=process.argv.slice(2),m=unseal(path.join(run,'run.json')),p=m.body.plan;
 const t={game:p.games.find(x=>x.id===g),arm:p.arms.find(x=>x.id===a),rep:Number(r)};
 if(!t.game||!t.arm||t.rep>=p.replicates||!p.checkpoints.includes(Number(n)))throw Error('checkpoint not in plan');
 let prev=null,item;for(const at of p.checkpoints){item=existing(run,m.hash,t,at,prev);if(!item)throw Error('missing checkpoint');prev=item.hash;if(at===Number(n))break}
 const {model,partial,game,arm,rep,episodes,started,train,validation,test,parent,experiment}=item.body,encoded=canonical(model);
 if(full==='yes'&&Buffer.byteLength(encoded)>128*1024)throw Error('model exceeds 128 KiB');
 const result={game,arm,rep,episodes,started,train,validation,test,parent,experiment,partial:partial?{steps:partial.steps,score:partial.score}:null,checkpointHash:item.hash,modelHash:digest(encoded),...(full==='yes'?{model}:{})};
 process.stdout.write(canonical(Object.fromEntries(Object.entries(result).filter(([,v])=>v!==undefined))));
}catch(e){console.error(e.message);process.exitCode=1}
