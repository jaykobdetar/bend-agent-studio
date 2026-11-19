import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {worldDefinition} from './finite_world.mjs';

// Finite-horizon optimal control with the public observation, ordered legal
// mask, chosen actions and observed rewards as the information available.
function greatestCommonDivisor(a,b) {
  while (b) [a,b]=[b,a%b];
  return a;
}

function probabilityRatio(a,b) {
  if (a===0n) return 0;
  if (a===b) return 1;
  if (b<=9007199254740991n) return Number(a)/Number(b);
  let exponent=a.toString(2).length-b.toString(2).length;
  if ((a<<BigInt(-exponent))<b) exponent--;
  if (exponent< -1075) return 0;
  const scale=Math.min(1074,52-exponent), scaled=a<<BigInt(scale);
  let significand=scaled/b;
  const twiceRemainder=(scaled% b)*2n;
  if (twiceRemainder>b || (twiceRemainder===b && (significand&1n)!==0n)) significand++;
  return Number(significand)*2**(-scale);
}

function resolveSubproblems(expand,initial) {
  const stack=[expand(...initial)];
  let value;
  while (stack.length) {
    const step=stack[stack.length-1].next(value);
    if (step.done) {
      value=step.value;
      stack.pop();
    } else {
      stack.push(expand(...step.value));
      value=undefined;
    }
  }
  return value;
}

function integerBuckets(xs) {
  const scale=4294967296n;
  const total=xs.reduce((n,e)=>n+BigInt(e.weight),0n);
  let before=0n, weight=0n;
  return xs.map(e=>{
    weight+=BigInt(e.weight);
    const boundary=weight*scale/total, count=boundary-before;
    before=boundary;
    return {...e,count};
  }).filter(e=>e.count!==0n);
}

export function publicPlanner(world,horizon,options={}) {
  return makePublicPlanner(world,horizon,options,true);
}

// A summary returns only the best initial decision. Do not retain an action
// explanation for every memoized belief when none can be requested later.
function makePublicPlanner(world,horizon,{maxBeliefs=100000,discount=1}={},keepChoices) {
  if (!Number.isSafeInteger(horizon) || horizon<0 || !Number.isSafeInteger(maxBeliefs) || maxBeliefs<1 ||
      !Number.isFinite(discount) || discount<0 || discount>1) throw Error('invalid planning horizon, discount, or belief limit');
  const states=new Map(world.states.map(s=>[s.id,s]));
  const visible=s=>JSON.stringify([s.observation??s.id,s.actions.map(a=>a.id)]);
  const views=new Map(world.states.map(s=>[s.id,visible(s)]));
  const transitions=new Map(world.states.map(s=>[s.id,new Map(s.actions.map(a=>[a.id,integerBuckets(a.outcomes)]))]));
  const root=new Map(), memo=new Map();
  let expanded=0;
  function add(groups,label,state,weight,reward=0) {
    if (!groups.has(label)) groups.set(label,{mass:new Map(),total:0n,reward});
    const group=groups.get(label);
    group.mass.set(state,(group.mass.get(state)??0n)+weight);group.total+=weight;
  }
  for (const o of integerBuckets(world.initial)) add(root,views.get(o.to),o.to,o.count);
  function solve(mass,depth) { return resolveSubproblems(expand,[mass,depth]); }
  function* expand(mass,depth) {
    const entries=[...mass].sort((a,b)=>a[0]-b[0]);
    const state=states.get(entries[0][0]);
    if (depth===0 || !state.actions.length) return {action:null,value:0,choices:[]};
    const divisor=entries.reduce((g,[,n])=>greatestCommonDivisor(g,n),0n);
    const reduced=entries.map(([s,n])=>[s,n/divisor]);
    const key=depth+';'+reduced.map(([s,n])=>s+':'+n).join(',');
    if (memo.has(key)) return memo.get(key);
    if (++expanded>maxBeliefs) throw Error('belief-state budget exceeded; increase maxBeliefs or reduce the horizon');
    const total=reduced.reduce((t,[,n])=>t+n,0n)*4294967296n;
    let best={action:null,value:-Infinity};
    const choices=keepChoices?[]:null;
    for (const a of state.actions) {
      const groups=new Map();
      for (const [s,n] of reduced) for (const event of transitions.get(s).get(a.id)) {
        const r=Object.is(event.reward,-0)?'-0':String(event.reward);
        add(groups,r+'|'+views.get(event.to),event.to,n*event.count,event.reward);
      }
      let value=0;
      for (const group of groups.values()) {
        const future=depth>1 && discount ? (yield [group.mass,depth-1]).value : 0;
        value+=probabilityRatio(group.total,total)*(group.reward+discount*future);
      }
      if (choices) choices.push({action:a.id,value});
      if (value>best.value) best={action:a.id,value};
    }
    if (choices) best.choices=choices;
    memo.set(key,best);
    return best;
  }
  function initial(observation,legal) {
    const group=root.get(JSON.stringify([observation,legal]));
    if (!group) throw Error('initial observation or legal mask is impossible under the world model');
    return group.mass;
  }
  function observe(mass,action,reward,nextObservation,nextLegal) {
    const out=new Map(), signature=JSON.stringify([nextObservation,nextLegal]);
    for (const [s,n] of mass) {
      const variants=transitions.get(s).get(action);
      if (!variants) throw Error('action is illegal in the public belief state');
      for (const e of variants) if (Object.is(e.reward,reward) && views.get(e.to)===signature) {
        out.set(e.to,(out.get(e.to)??0n)+n*e.count);
      }
    }
    if (!out.size) throw Error('observed transition is impossible under the world model');
    const gcd=[...out.values()].reduce(greatestCommonDivisor,0n);
    return new Map([...out].map(([s,n])=>[s,n/gcd]));
  }
  function summary() {
    const decisions=[];let value=0;
    for (const [view,group] of root) {
      const [observation,legal]=JSON.parse(view), result=solve(group.mass,horizon);
      const probability=probabilityRatio(group.total,4294967296n);
      decisions.push({observation,legal,probability,action:result.action,value:result.value});
      value+=probability*result.value;
    }
    return {horizon,discount,optimalPublicHistoryReturn:value,beliefsExamined:expanded,initialDecisions:decisions};
  }
  return {initial,observe,solve,summary};
}

export function beliefOracle(world,horizon,options) {
  return makePublicPlanner(world,horizon,options,false).summary();
}

// In a previous-observation arm, H.history_id encodes the ranked public
// observation in the low radix digit; the planner consumes original world IDs.
export function publicTraceFrames(world, frames, encoding) {
  if (encoding !== 'previous') return frames;
  const ids=[...new Set(world.states.map(s=>s.observation??s.id))].sort((a,b)=>a-b);
  const n=ids.length;
  const decode=v=>{
    if (!Number.isSafeInteger(v)||v<0||v>=n*(n+1)) throw Error('invalid history-encoded observation');
    return ids[v%n];
  };
  return frames.map(f=>({...f,observation:decode(f.observation),
    ...(f.accepted ? {nextObservation:decode(f.nextObservation)} : {})}));
}

export function explainDecisions(world,horizon,frames,options={}) {
  if (!Array.isArray(frames) || frames.length>horizon) throw Error('invalid public trace length');
  const planner=publicPlanner(world,horizon,options);
  if (!frames.length) return {decisions:[],discountedDecisionGaps:0};
  let mass=planner.initial(frames[0].observation,frames[0].legal),discountedDecisionGaps=0;
  const decisions=[];
  for (const [i,f] of frames.entries()) {
    if (i>0 && (frames[i-1].terminal || frames[i-1].truncated || !frames[i-1].accepted ||
        frames[i-1].nextObservation!==f.observation || JSON.stringify(frames[i-1].nextLegal)!==JSON.stringify(f.legal))) {
      throw Error('discontinuous public trace at decision '+i);
    }
    const left=horizon-i, best=planner.solve(mass,left);
    const chosen=best.choices.find(c=>c.action===f.action);
    if (!chosen) {
      if (f.accepted || i!==frames.length-1) throw Error('illegal action marked as an accepted move');
      decisions.push({step:i,observation:f.observation,action:f.action,accepted:false,bestAction:best.action,bestValue:best.value,gap:null});
      break;
    }
    if (!f.accepted) throw Error('a model-legal action was marked refused');
    const gap=best.value-chosen.value;
    decisions.push({step:i,observation:f.observation,action:f.action,accepted:true,bestAction:best.action,
      bestValue:best.value,chosenValue:chosen.value,gap,possibleHiddenStates:mass.size});
    discountedDecisionGaps+=(options.discount??1)**i*gap;
    mass=planner.observe(mass,f.action,f.reward,f.nextObservation,f.nextLegal);
    if (f.terminal!==!f.nextLegal.length || f.truncated!==(i===horizon-1 && !f.terminal)) {
      throw Error('trace stop flags disagree with the world or horizon');
    }
  }
  return {decisions,discountedDecisionGaps};
}

// Enumerate the declared Markov kernel of a finite world for a public policy.
// policy(observation, legal, remaining) returns a legal ID or a probability vector.
function distributionOf(policy, observation, legal, remaining) {
  const result=policy(observation,[...legal],remaining);
  if (Number.isInteger(result)) {
    if (!legal.includes(result)) throw Error('exact evaluator received an illegal action');
    return legal.map(a=>Number(a===result));
  }
  if (!Array.isArray(result) || result.length!==legal.length ||
      result.some(p=>!Number.isFinite(p) || p<0 || p>1) ||
      Math.abs(result.reduce((a,b)=>a+b,0)-1)>1e-12) throw Error('invalid action probabilities');
  return result;
}

export function policyOracle(world,horizon,policy,{behavior=null,observation='current',discount=1,memory=null,maxStates=100000}={}) {
  if (!Number.isSafeInteger(horizon) || horizon<0 || !Number.isSafeInteger(maxStates) || maxStates<1 || !['current','previous'].includes(observation) ||
      !Number.isFinite(discount) || discount<0 || discount>1) throw Error('invalid finite policy evaluation');
  if (memory && (!Number.isSafeInteger(memory.initial) || typeof memory.encode!=='function' || typeof memory.advance!=='function')) {
    throw Error('memory needs an integer initial state, public encoder, and update');
  }
  const states=new Map(world.states.map(s=>[s.id,s]));
  const ids=[...new Set(world.states.map(s=>s.observation??s.id))].sort((a,b)=>a-b);
  if (observation==='previous' && ids.length*(ids.length+1)>2**32) throw Error('history encoding exceeds U32');
  const rank=new Map(ids.map((v,i)=>[v,i]));
  const kernel=new Map(world.states.map(s=>[s.id,s.actions.map(a=>integerBuckets(a.outcomes).map(e=>({...e,p:Number(e.count)/4294967296})))]));
  const memo=new Map();
  let expanded=0;
  const zero=()=>({v:0,v2:0,steps:0,term:0,limited:0,unsupported:0,uncovered:false,w2:0,w2g:0,w2g2:0});
  function add(sum,result,p) {
    for (const key of Object.keys(sum)) {
      if (key==='uncovered') sum.uncovered ||= result.uncovered;
      else sum[key]+=p*result[key];
    }
  }
  function value(id,previous,left) { return resolveSubproblems(expand,[id,previous,left]); }
  function* expand(id,previous,left) {
    const key=id+','+previous+','+left;
    if (memo.has(key)) return memo.get(key);
    if (++expanded>maxStates) throw Error('policy-state budget exceeded; increase maxStates or reduce the horizon');
    const s=states.get(id), out=zero();
    if (!s.actions.length || !left) {
      out.term=Number(!s.actions.length);out.limited=1-out.term;out.w2=1;
    } else {
      const visible=s.observation??s.id, i=rank.get(visible);
      const obs=memory?memory.encode(previous,visible):observation==='current'?visible:(previous+1)*ids.length+i;
      const nextPrevious=observation==='current'?-1:i, legal=s.actions.map(a=>a.id);
      const target=distributionOf(policy,obs,legal,left);
      const logger=behavior?distributionOf(behavior,obs,legal,left):target;
      for (let a=0;a<target.length;a++) {
        const pi=target[a], mu=logger[a];
        if (!pi) continue;
        for (const e of kernel.get(id)[a]) {
          const after=states.get(e.to);
          const h=memory?memory.advance(previous,visible,legal[a],e.reward,after.observation??after.id,after.actions.map(a=>a.id)):nextPrevious;
          if (!Number.isSafeInteger(h)) throw Error('memory update must return an integer state');
          const next=yield [e.to,h,left-1];
          const p=pi*e.p, r=e.reward, d=discount;
          out.v+=p*(r+d*next.v);
          out.v2+=p*(r*r+2*r*d*next.v+d*d*next.v2);
          out.steps+=p*(1+next.steps);out.term+=p*next.term;out.limited+=p*next.limited;
          out.uncovered ||= mu===0 || next.uncovered;
          out.unsupported+=p*(mu===0?1:next.unsupported);
          if (mu>0) {
            const k=p*pi/mu;
            out.w2+=k*next.w2;
            out.w2g+=k*(r*next.w2+d*next.w2g);
            out.w2g2+=k*(r*r*next.w2+2*r*d*next.w2g+d*d*next.w2g2);
          }
        }
      }
    }
    memo.set(key,out);return out;
  }
  const out=zero();
  for (const e of integerBuckets(world.initial)) add(out,value(e.to,memory?.initial??-1,horizon),Number(e.count)/4294967296);
  const ans={expectedReturn:out.v,returnVariance:Math.max(0,out.v2-out.v*out.v),expectedSteps:out.steps,
    terminalProbability:out.term,limitProbability:out.limited,statesEvaluated:memo.size};
  if (behavior) {
    const covered=!out.uncovered, finite=Number.isFinite(out.w2) && Number.isFinite(out.w2g) && Number.isFinite(out.w2g2);
    ans.overlap={coverageComplete:covered,unsupportedTargetPathProbability:!covered && out.unsupported===0?null:out.unsupported,
      asymptoticEssFraction:covered && finite?1/out.w2:null,
      ordinaryVariancePerEpisode:covered && finite?Math.max(0,out.w2g2-out.v*out.v):null,
      normalizedAsymptoticVariancePerEpisode:covered && finite?Math.max(0,out.w2g2-2*out.v*out.w2g+out.v*out.v*out.w2):null};
  }
  return ans;
}

// Optimize over deterministic policies that see only the current public view
// and remaining horizon. Every episode at a given time uses the same mapping.
// Occupancy tracks the distribution of all surviving episodes, including all
// earlier observations and rewards that this policy class cannot remember.
export function clockOracle(world,horizon,{maxOccupancies=50000,maxPrescriptions=1000000,discount=1}={}) {
  if (!Number.isSafeInteger(horizon) || horizon<0 || !Number.isSafeInteger(maxOccupancies) || maxOccupancies<1 ||
      !Number.isSafeInteger(maxPrescriptions) || maxPrescriptions<1 || !Number.isFinite(discount) || discount<0 || discount>1)
    throw Error('invalid reactive planner horizon, discount or search budget');
  const states=new Map(world.states.map(s=>[s.id,s]));
  const kernels=new Map(world.states.map(s=>[s.id,new Map(s.actions.map(a=>[a.id,integerBuckets(a.outcomes)]))]));
  const view=s=>JSON.stringify([s.observation??s.id,s.actions.map(a=>a.id)]);
  const views=new Map(world.states.map(s=>[s.id,view(s)]));
  const root=new Map(), memo=new Map(), unit=4294967296n;
  for(const e of integerBuckets(world.initial))root.set(e.to,(root.get(e.to)??0n)+e.count);
  let examined=0,prescriptions=0;
  function* expand(input,left) {
    if(!left)return {value:0,plan:null};
    const active=[...input].filter(([s])=>states.get(s).actions.length).sort((a,b)=>a[0]-b[0]);
    if(!active.length)return {value:0,plan:null};
    const total=[...input.values()].reduce((a,b)=>a+b,0n);
    const activeTotal=active.reduce((s,[,p])=>s+p,0n),alive=probabilityRatio(activeTotal,total);
    const gcd=active.reduce((s,[,p])=>greatestCommonDivisor(s,p),0n);
    const reduced=active.map(([s,p])=>[s,p/gcd]);
    const key=left+';'+reduced.map(([s,p])=>s+':'+p).join(',');
    const counted=memo.get(key);
    if(counted)return {value:alive*counted.value,plan:counted.plan};
    if(++examined>maxOccupancies)throw Error('clock oracle occupancy budget exceeded');
    const options=new Map();
    for(const [id] of reduced)options.set(views.get(id),states.get(id).actions.map(a=>a.id));
    const rooms=[...options.keys()].sort(), choices=rooms.map(key=>options.get(key));
    const indices=rooms.map(()=>0),denom=(activeTotal/gcd)*unit;
    let best=-Infinity,plan=null,done=false;
    while(!done) {
      if(++prescriptions>maxPrescriptions)throw Error('clock oracle prescription budget exceeded');
      const moves=new Map(rooms.map((key,i)=>[key,choices[i][indices[i]]]));
      const next=new Map();let reward=0;
      for(const [id,p] of reduced)for(const e of kernels.get(id).get(moves.get(views.get(id)))) {
        const mass=p*e.count;
        reward+=probabilityRatio(mass,denom)*e.reward;
        next.set(e.to,(next.get(e.to)??0n)+mass);
      }
      const suffix=left>1 && discount?(yield [next,left-1]):{value:0,plan:null};
      const score=reward+discount*suffix.value;
      if(score>best) {
        best=score;
        plan={moves:[...moves].map(([signature,action])=>{const [observation,legal]=JSON.parse(signature);return {observation,legal,action};}),next:suffix.plan};
      }
      let i=indices.length-1;
      while(i>=0 && ++indices[i]===choices[i].length){indices[i]=0;i--;}
      done=i<0;
    }
    memo.set(key,{value:best,plan});
    return {value:alive*best,plan};
  }
  const result=resolveSubproblems(expand,[root,horizon]),policy=[];
  for(let x=result.plan;x;x=x.next)policy.push(x.moves);
  return {horizon,discount,optimalClockReactiveReturn:result.value,occupanciesExamined:examined,prescriptionsExamined:prescriptions,policy};
}

export function main(args) {
  const [file,horizon,...options]=args;
  if (!file || horizon===undefined || options.length%2) throw Error('usage: node public_oracle.mjs WORLD HORIZON [--class history|clock] [--trace REPLAY.json] [--discount G] [--max-beliefs N] [--max-occupancies N] [--max-prescriptions N]');
  const settings={};
  let traceFile,kind='history';
  for (let i=0;i<options.length;i+=2) {
    const value=options[i+1];
    switch(options[i]) {
      case '--max-beliefs':settings.maxBeliefs=Number(value);break;
      case '--max-occupancies':settings.maxOccupancies=Number(value);break;
      case '--max-prescriptions':settings.maxPrescriptions=Number(value);break;
      case '--discount':settings.discount=Number(value);break;
      case '--class':kind=value;break;
      case '--trace':traceFile=value;break;
      default:throw Error('unknown option '+options[i]);
    }
  }
  if (!['history','clock'].includes(kind) || (traceFile && kind!=='history') ||
      (kind==='clock' && settings.maxBeliefs!==undefined) ||
      (kind==='history' && (settings.maxOccupancies!==undefined || settings.maxPrescriptions!==undefined))) throw Error('incompatible policy class and options');
  const definition=worldDefinition(JSON.parse(fs.readFileSync(file,'utf8')));
  const h=Number(horizon);
  let result;
  if (traceFile) result=explainDecisions(definition,h,JSON.parse(fs.readFileSync(traceFile,'utf8')).frames,settings);
  else if (kind==='clock') result=clockOracle(definition,h,settings);
  else result=beliefOracle(definition,h,settings);
  console.log(JSON.stringify(result,null,2));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {main(process.argv.slice(2))} catch (error) {console.error(error.message);process.exitCode=1;}
}
