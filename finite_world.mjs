import {createHash} from 'node:crypto';

const WORDS=2**32;
function object(x, keys, where) {
  if (!x || typeof x!=='object' || Array.isArray(x) || Object.keys(x).some(k=>!keys.includes(k))) {
    throw Error('invalid fields in '+where);
  }
}
function u32(x,label) {
  if (!Number.isInteger(x) || x<0 || x>=WORDS) throw Error('invalid U32 '+label);
  return x;
}
function ids(items,label) {
  if (new Set(items.map(i=>i.id)).size!==items.length) throw Error('duplicate '+label);
}
function distribution(xs,withRewards) {
  if (!Array.isArray(xs) || !xs.length) throw Error('empty outcome distribution');
  let total=0;
  const out=xs.map(x=>{
    object(x,withRewards?['to','weight','reward']:['to','weight'],'outcome');
    const to=u32(x.to,'destination');
    if (!Number.isSafeInteger(x.weight) || x.weight<1 || x.weight>WORDS) throw Error('weights must be positive integers');
    total+=x.weight;
    if (total>WORDS) throw Error('total outcome weight exceeds 2^32');
    if (!withRewards) return {to,weight:x.weight};
    if (typeof x.reward!=='number' || !Number.isFinite(Math.fround(x.reward))) throw Error('reward must be finite F32');
    return {to,weight:x.weight,reward:Math.fround(x.reward)};
  });
  return out;
}
function gridWorld(input) {
  object(input,['schema','grid','stepReward','goalReward','pitReward','slip'],'grid world');
  const grid=input.grid;
  if (input.schema!==1 || !Array.isArray(grid) || !grid.length || typeof grid[0]!=='string' || !grid[0].length ||
      grid.some(row=>typeof row!=='string' || row.length!==grid[0].length || /[^.SGP#]/.test(row))) {
    throw Error('grid must be a nonempty rectangle of . S G P # cells');
  }
  const slip=input.slip??0;
  if (typeof slip!=='number' || !Number.isFinite(slip) || slip<0 || slip>1) throw Error('slip must be in [0,1]');
  const k=Math.round(slip*65536), width=grid[0].length;
  const initial=[], states=[];
  const steps=[[-1,0],[0,1],[1,0],[0,-1]];
  for (let y=0;y<grid.length;y++) for (let x=0;x<width;x++) {
    const cell=grid[y][x], id=y*width+x;
    if (cell==='#') continue;
    if (cell==='S') initial.push({to:id,weight:1});
    const directions=[];
    if (cell!=='G' && cell!=='P') for (const [a,[dy,dx]] of steps.entries()) {
      const ny=y+dy, nx=x+dx, next=grid[ny]?.[nx];
      if (next===undefined || next==='#') continue;
      const reward=next==='G'?(input.goalReward??0):next==='P'?(input.pitReward??-10):(input.stepReward??-1);
      directions.push({a,to:ny*width+nx,reward});
    }
    const actions=directions.map(({a})=>({id:a,outcomes:directions.map(({a:other,to,reward})=>(
      {to,reward,weight:k+(a===other?(65536-k)*directions.length:0)})).filter(o=>o.weight>0)}));
    states.push({id,actions});
  }
  if (!initial.length) throw Error('grid needs at least one S');
  return {schema:1,initial,states};
}

export function worldDefinition(input) {
  if (input && Object.hasOwn(input,'grid')) input=gridWorld(input);
  object(input,['schema','initial','states'],'world');
  if (input.schema!==1 || !Array.isArray(input.states) || !input.states.length) throw Error('world needs schema 1 and a nonempty states list');
  const initial=distribution(input.initial,false);
  const states=input.states.map(s=>{
    object(s,['id','observation','actions'],'state');
    const id=u32(s.id,'state');
    if (!Array.isArray(s.actions)) throw Error('each state must declare its actions');
    const actions=s.actions.map(a=>{
      object(a,['id','outcomes'],'action');
      return {id:u32(a.id,'action'),outcomes:distribution(a.outcomes,true)};
    });
    ids(actions,'action in state '+id);
    return {id,observation:u32(s.observation===undefined?id:s.observation,'observation'),actions};
  });
  ids(states,'state');
  const known=new Set(states.map(s=>s.id));
  for (const xs of [initial,...states.flatMap(s=>s.actions.map(a=>a.outcomes))]) {
    for (const x of xs) if (!known.has(x.to)) throw Error('unknown destination '+x.to);
  }
  return {schema:1,initial,states};
}

// Cumulative boundaries partition every 32-bit word exactly once. BigInt
// keeps rounding reproducible even when both factors have 32 significant bits.
export function buckets(xs) {
  const total=BigInt(xs.reduce((n,x)=>n+x.weight,0));
  let cumulative=0n, before=0;
  return xs.map(x=>{
    cumulative+=BigInt(x.weight);
    const end=Number((cumulative*4294967296n)/total);
    const result={...x,upper:end-1,probability:(end-before)/WORDS};
    before=end;
    return result;
  });
}
export function numberPreservingJson(value, space) {
  return JSON.stringify(value, (_key,x)=>Object.is(x,-0)?JSON.rawJSON('-0'):x, space);
}
export function symbol(definition) {
  return 'scene_'+createHash('sha256').update(numberPreservingJson(worldDefinition(definition))).digest('hex').slice(0,20);
}
export function floatLiteral(x) {
  const a=Math.abs(x);
  let s=String(a);
  if (!s.includes('.') && !s.includes('e')) s+='.0';
  if (s.includes('e') && !s.includes('.')) s=s.replace('e','.0e');
  return x<0 || Object.is(x,-0)?'F32.neg('+s+')':s;
}
function distributionCode(xs) {
  if (xs.length===1) return '('+xs[0].to+', '+floatLiteral(xs[0].reward??0)+')';
  return 'F.draw(['+buckets(xs).map(x=>'F.Outcome{'+x.upper+', '+x.to+', '+floatLiteral(x.reward??0)+'}').join(', ')+'], word)';
}
export function bendSource(d) {
  const lines=['import Base','import ./engine.bend as E','import ./finite.bend as F','import ./history.bend as H','',
    'def reset(seed: U32) -> U32:', '  word = E.mix_word(U32.xor(seed, 3266489917))',
    '  F.destination('+distributionCode(d.initial)+')','','def view(state: U32) -> E.View<U32>:','  match state:'];
  for (const s of d.states) {
    const actions=s.actions.map(a=>a.id).join(', ');
    lines.push('    case '+s.id+': '+(actions?'E.Open{'+s.observation+', ['+actions+']}':'E.End{'+s.observation+'}'));
  }
  lines.push('    case unknown: E.End{unknown}','','def step(state: U32, action: U32, word: U32) -> Pair(U32, F32):','  match state action:');
  for (const s of d.states) for (const a of s.actions) lines.push('    case '+s.id+' '+a.id+': '+distributionCode(a.outcomes));
  lines.push('    case unchanged _: (unchanged, 0.0)','','def world() -> E.World<U32, U32>: E.World{reset, view, step}','');
  const obs=[...new Set(d.states.map(s=>s.observation))].sort((a,b)=>a-b);
  if ((obs.length+1)*obs.length<=WORDS) {
    lines.push('def rank(obs: U32) -> U32:', '  match obs:');
    for (const [i,id] of obs.entries()) lines.push('    case '+id+': '+i);
    lines.push('    case _: 0','','def history_world() -> E.World<H.State<U32,H.Previous>,U32>:',
      '  H.wrap(~U32, ~U32, ~H.Previous, ~U32, ~reset, ~view, ~step, ~H.First{},',
      '         ~(h => o => H.history_id(~rank, '+obs.length+', h, o)), ~H.remember_previous)','');
  }
  return lines.join('\n');
}
export function oracle(world,horizon,discount=1) {
  if (!Number.isFinite(discount)||discount<0||discount>1) throw Error('discount must be in [0,1]');
  if (!Number.isSafeInteger(horizon) || horizon<0) throw Error('horizon must be a nonnegative integer');
  const index=new Map(world.states.map((s,i)=>[s.id,i]));
  const transitions=world.states.map(s=>s.actions.map(a=>buckets(a.outcomes).map(x=>({...x,to:index.get(x.to)}))));
  let best=world.states.map(()=>0), uniform=world.states.map(()=>0);
  for (let h=0;h<horizon;h++) {
    const opt=[], rand=[];
    for (const as of transitions) {
      let maximum=-Infinity, total=0;
      for (const outcomes of as) {
        let qo=0, qu=0;
        for (const x of outcomes) {
          qo+=x.probability*(x.reward+discount*best[x.to]);
          qu+=x.probability*(x.reward+discount*uniform[x.to]);
        }
        maximum=Math.max(maximum,qo); total+=qu;
      }
      opt.push(as.length?maximum:0); rand.push(as.length?total/as.length:0);
    }
    best=opt; uniform=rand;
  }
  const start=buckets(world.initial);
  return {horizon,states:world.states.length,distinctObservations:new Set(world.states.map(s=>s.observation)).size,
    optimalFullStateReturn:start.reduce((v,x)=>v+x.probability*best[index.get(x.to)],0),
    uniformReturn:start.reduce((v,x)=>v+x.probability*uniform[index.get(x.to)],0)};
}

// Exhaust all deterministic stationary policies sharing a decision at states
// with the same observation and ordered legal-action list.
export function reactiveOracle(world,horizon) {
  const baseline=oracle(world,horizon);
  const groups=[], byView=new Map(), stateIndex=new Map(world.states.map((s,i)=>[s.id,i]));
  const states=world.states.map(s=>{
    if (!s.actions.length) return {group:-1,actions:[]};
    const key=JSON.stringify([s.observation,s.actions.map(a=>a.id)]);
    if (!byView.has(key)) {byView.set(key,groups.length); groups.push(s.actions.length);}
    return {group:byView.get(key),actions:s.actions.map(a=>buckets(a.outcomes).map(x=>({...x,to:stateIndex.get(x.to)})))};
  });
  const policies=groups.reduce((n,k)=>n*BigInt(k),1n);
  if (policies>50000n) throw Error('exact reactive enumeration would need '+policies+' policies; use the full-state oracle');
  const choices=groups.map(()=>0), initial=buckets(world.initial);
  let best=-Infinity;
  for (let policy=0;policy<Number(policies);policy++) {
    let v=states.map(()=>0);
    for (let t=0;t<horizon;t++) {
      v=states.map(s=>s.group<0?0:s.actions[choices[s.group]].reduce((n,x)=>n+x.probability*(x.reward+v[x.to]),0));
    }
    best=Math.max(best,initial.reduce((n,x)=>n+x.probability*v[stateIndex.get(x.to)],0));
    for (let j=0;j<choices.length;j++) { if (++choices[j]<groups[j]) break; choices[j]=0; }
  }
  return {...baseline,deterministicReactivePolicies:Number(policies),optimalStationaryReactiveReturn:best};
}

// Full-state planning, not a policy restricted to observations. At gamma=1
// require a finite bound on time to absorption under every possible action.
export function discountedOracle(world,discount,tolerance=1e-9) {
  if(!Number.isFinite(discount)||discount<0||discount>1) throw Error('discount must be in [0,1]');
  if(!Number.isFinite(tolerance)||tolerance<=0) throw Error('tolerance must be positive and finite');
  const idx=new Map(world.states.map((s,i)=>[s.id,i]));
  const rows=world.states.map(s=>s.actions.map(a=>buckets(a.outcomes).filter(x=>x.probability>0).map(x=>({...x,to:idx.get(x.to)}))));
  if(discount===1) {
    const incoming=rows.map(()=>0),queue=[];
    for(const actions of rows) for(const outcomes of actions) for(const x of outcomes) incoming[x.to]++;
    incoming.forEach((n,i)=>{if(!n)queue.push(i)});
    for(let i=0;i<queue.length;i++) for(const outcomes of rows[queue[i]]) for(const x of outcomes) if(!--incoming[x.to])queue.push(x.to);
    if(queue.length!==rows.length)throw Error('discount 1 requires an acyclic transition graph; use a discount below 1 for cyclic worlds');
  }
  const q=(out,v)=>out.reduce((a,x)=>a+x.probability*(x.reward+discount*v[x.to]),0);
  const best=(actions,v)=>actions.reduce((b,a,i)=>{const value=q(a,v);return value>b.value?{i,value}:b},{i:-1,value:-Infinity});
  const zeros=()=>rows.map(()=>0);
  function iterate(policy,start) {
    let v=start;
    for(let n=1;n<=100000;n++){
      const next=rows.map((a,i)=>!a.length?0:policy?q(a[policy[i]],v):best(a,v).value);
      let delta=0;for(let i=0;i<v.length;i++)delta=Math.max(delta,Math.abs(v[i]-next[i]));
      if(!Number.isFinite(delta))throw Error('non-finite discounted value');
      if(delta===0||(discount<1 && delta<=tolerance*(1-discount)))return {v:next,n};
      v=next;
    }
    throw Error('discounted iteration budget exceeded');
  }
  const vi=iterate(null,zeros()),policy=zeros();let v=zeros(),evaluations=0;
  const start=v=>buckets(world.initial).reduce((z,x)=>z+x.probability*v[idx.get(x.to)],0);
  for(let n=1;n<=10000;n++){
    const evaluated=iterate(policy,v);v=evaluated.v;evaluations+=evaluated.n;
    let changed=false;
    rows.forEach((a,i)=>{if(!a.length)return;const b=best(a,v);if(b.value>q(a[policy[i]],v)){policy[i]=b.i;changed=true;}});
    if(!changed)return {discount,tolerance,states:rows.length,valueIteration:{optimalFullStateReturn:start(vi.v),iterations:vi.n},policyIteration:{optimalFullStateReturn:start(v),iterations:n,evaluationSweeps:evaluations}};
  }
  throw Error('policy improvement budget exceeded');
}
