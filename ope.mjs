// Undiscounted, finite-horizon deterministic targets. Fit only on training
// episodes. Missing empirical cells receive zero, not a maximized continuation.
import {actionBuckets} from './dataset.mjs';
const key=(f,a)=>JSON.stringify([f.observation,f.legal,a]);
export function fitQEvaluation(training,act){
  const cells=[];
  for(const ep of training)ep.frames.forEach((f,t)=>(cells[t]??=[]).push(f));
  const q=[];
  for(let t=cells.length-1;t>=0;t--){
    const table=q[t]=new Map();
    for(const f of cells[t]){
      const next={observation:f.nextObservation,legal:f.nextLegal};
      const continuation=f.terminal||f.truncated?0:q[t+1]?.get(key(next,act(next.observation,next.legal)))?.mean??0;
      const k=key(f,f.action),v=table.get(k)??{n:0,mean:0};
      v.mean+=(f.reward+continuation-v.mean)/++v.n;table.set(k,v);
    }
  }
  return (t,f,a)=>q[t]?.get(key(f,a))?.mean??0;
}
export function stepEstimates(episodes,act,buckets,q){
  const n=episodes.length,h=episodes.reduce((h,e)=>Math.max(h,e.frames.length),0);
  if(!n)throw Error('held-out episodes required');
  const den=Array(h).fill(0),num=Array(h).fill(0);
  let pdis=0,fqe=0,dr=0,unsupported=false,overflow=false;
  for(const ep of episodes){
    const first=ep.frames[0],v0=first?q(0,first,act(first.observation,first.legal)):0;
    fqe+=v0;dr+=v0;let w=1;
    for(let t=0;t<h;t++){
      const f=ep.frames[t];
      if(!f){den[t]+=w;continue;} // absorbing padding carries terminal weight
      if(w===0)break;
      const a=act(f.observation,f.legal),i=f.legal.indexOf(a);
      if(i<0)throw Error('illegal target action');
      if(!actionBuckets(f.legal,f.preferred,buckets)[i])unsupported=true;
      if(f.action!==a)break;
      w*=65536/f.propensityBuckets;
      if(!Number.isFinite(w)){overflow=true;break;}
      const gain=w*f.reward;
      const next={observation:f.nextObservation,legal:f.nextLegal};
      const vn=f.terminal||f.truncated?0:q(t+1,next,act(next.observation,next.legal));
      den[t]+=w;num[t]+=gain;pdis+=gain;dr+=w*(f.reward+vn-q(t,f,a));
    }
  }
  const finite=x=>Number.isFinite(x)?x:null,usable=!unsupported&&!overflow;
  return {pdis:usable?finite(pdis/n):null,weighted_pdis:usable&&den.every(d=>d>0&&Number.isFinite(d))?finite(num.reduce((v,x,t)=>v+x/den[t],0)):null,
    fqe:finite(fqe/n),doubly_robust:usable?finite(dr/n):null};
}
