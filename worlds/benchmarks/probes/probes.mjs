// Small public-observation diagnostics. Each generator enumerates reachable
// states only. Private tuples never become observations unless requested.
const range = n => Array.from({length:n}, (_,i)=>i);
const outcome = (next, reward=0, weight=1) => ({next,reward,weight});
const sizes = Object.freeze({
  'deep-sea':[3,5], umbrella:[3,5], memory:[3,5],
  discount:[3,6], bandit:[2,4], catch:[2,4],
});
export {sizes};

function reachable(starts, describe) {
  const ids=new Map(), queue=[], states=[];
  function intern(tuple) {
    const key=JSON.stringify(tuple);
    if(!ids.has(key)) {ids.set(key,queue.length); queue.push(tuple);}
    return ids.get(key);
  }
  const initial=starts.map(k=>({to:intern(k),weight:1}));
  for(let i=0;i<queue.length;i++) {
    const {observation,choices}=describe(queue[i],i);
    const actions=choices.map((xs,id)=>({id,outcomes:xs.map(({next,reward,weight})=>({to:intern(next),reward,weight}))}));
    states.push({id:i,observation,actions});
  }
  return {schema:1,initial,states};
}
const end = {observation:0,choices:[]};
const terminal = reward => [outcome([],reward)];

// Mapping is frozen per cell in the generated world: never a per-step RNG.
export const mappingSeed=3;
export function rightAction(row,col,seed=mappingSeed) {
  let x=(seed ^ Math.imul(row+1,0x9e3779b1) ^ Math.imul(col+1,0x85ebca77))>>>0;
  x=Math.imul(x^(x>>>16),0x21f0aaad);
  return (x^(x>>>15))&1;
}
function deepSea(n) {
  return reachable([[0,0]],([t,c],i)=>{
    if(t===undefined) return end;
    return {observation:i+1,choices:range(2).map(a=>{
      const right=a===rightAction(t,c), last=t===n-1;
      const r=(right&&c===n-1?1:0)-(right?0.01/n:0);
      return last?terminal(r):[outcome([t+1,Math.min(n-1,Math.max(0,c+(right?1:-1)))],r)];
    })};
  });
}
function umbrella(n) {
  // Need is public; only the first decision fixes possession. Intermediate
  // rewards are symmetric noise, so the terminal signal must cross the delay.
  return reachable([[0,0,0],[0,1,0]],([t,need,carry],i)=>{
    if(t===undefined) return end;
    return {observation:i+1,choices:range(2).map(a=>{
      const held=t===0?a:carry;
      if(t===n-1) return terminal(held===need?1:-1);
      const next=[t+1,need,held];
      return [outcome(next,-1),outcome(next,1)];
    })};
  });
}
function memory(n) {
  return reachable([[0,0],[0,1]],([t,bit])=>{
    if(t===undefined) return end;
    // Cues 1 and 2 appear only on reset. Afterward only the clock is public.
    return {observation:t===0?1+bit:2+t,choices:t===n-1?
      range(2).map(a=>terminal(a===bit?1:-1)):[[outcome([t+1,bit])]]};
  });
}
export function cueMemory(n) {
  return {schema:1,states:2,initial:0,observationStride:n+3,otherwise:'keep',
    rules:[{observation:1,to:0},{observation:2,to:1}]};
}
function discount(n) {
  return reachable([[0,0]],([t,choice],i)=>{
    if(t===undefined) return end;
    if(t===0) return {observation:i+1,choices:[[outcome([1,0],1)],[outcome([1,1])]]};
    return {observation:i+1,choices:[t===n-1?terminal(choice?1.25:0):[outcome([t+1,choice])]]};
  });
}
function bandit(n) {
  // More arms reduce a uniform policy's chance of picking the sole good one.
  return reachable([[0]],([t])=>t===undefined?end:{observation:1,
    choices:range(n).map(a=>[outcome([],1,a===n-1?3:1),outcome([],-1,a===n-1?1:3)])});
}
function catchGame(width) {
  // Three rows: two controllable moves before landing. The ball is visible.
  return reachable(range(width).map(ball=>[0,ball,Math.floor(width/2)]),([t,ball,paddle],i)=>{
    if(t===undefined) return end;
    return {observation:i+1,choices:[-1,0,1].map(move=>{
      const p=Math.min(width-1,Math.max(0,paddle+move));
      return t===1?terminal(p===ball?1:-1):[outcome([t+1,ball,p])];
    })};
  });
}
const factories={'deep-sea':deepSea,umbrella,memory,discount,bandit,catch:catchGame};
export function probe(name,size) {
  if(!Object.hasOwn(sizes,name) || !sizes[name].includes(size)) throw Error('unknown probe or unsupported size');
  const horizon=name==='bandit'?1:name==='catch'?2:size;
  return {definition:factories[name](size),horizon};
}
