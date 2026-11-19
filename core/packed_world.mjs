// Compact literal pages are data. Bend still executes reset, view, step,
// sampling, history and all engine/learner logic; there is no JS simulator.
const PAGE=128;
const scratch=new DataView(new ArrayBuffer(4));
function bits(x) { scratch.setFloat32(0,x); return scratch.getUint32(0); }
function encode(word) {
  return String.fromCharCode(0xe000+(word>>>22),0xe000+((word>>>11)&2047),0xe000+(word&2047));
}
export function packedSource(d,buckets) {
  const rows=[...d.states].sort((a,b)=>a.id-b.id);
  const gap=rows.findIndex((s,i)=>s.id!==i);
  const prefix=gap===-1?rows.length:gap;
  const ranked=[...new Set(rows.map(s=>s.observation))].sort((a,b)=>a-b);
  const words=Array(4*rows.length).fill(0);
  const rankAt=words.length;for(const id of ranked)words.push(id);
  function dist(xs) {
    const base=words.length;
    for(const x of buckets(xs))words.push(x.upper,x.to,bits(x.reward??0));
    return base;
  }
  const initial=dist(d.initial);
  for(const [i,s] of rows.entries()) {
    const start=words.length;
    words[4*i]=s.id; words[4*i+1]=s.observation; words[4*i+2]=s.actions.length; words[4*i+3]=start;
    for(const a of s.actions)words.push(a.id,a.outcomes.length,0);
    for(const [j,a] of s.actions.entries())words[start+3*j+2]=dist(a.outcomes);
  }
  if(words.length>0xffffffff)throw Error('packed finite world exceeds U32 address space');
  const pages=[];
  for(let i=0;i<words.length;i+=PAGE)pages.push(words.slice(i,i+PAGE).map(encode).join(''));
  const out=['import Base','import ./engine.bend as E','import ./packed_world.bend as P','import ./history.bend as H','',
    'def page(id: U32) -> String:','  match id:',...pages.map((s,i)=>'    case '+i+': '+JSON.stringify(s)),
    '    case _: ""','','def at(index: U32) -> U32:', '  +i = index',
    '  P.page_word(page(U32.div(i,'+PAGE+')),U32.mod(i,'+PAGE+'))','',
    'def reset(seed: U32) -> U32:',
    '  P.destination(P.draw(~at,'+initial+','+d.initial.length+',E.mix_word(U32.xor(seed,3266489917))))','',
    'def view(s: U32) -> E.View<U32>: P.view(~at,'+rows.length+','+prefix+',s)','',
    'def step(s: U32, a: U32, w: U32) -> Pair(U32,F32): P.step(~at,'+rows.length+','+prefix+',s,a,w)','',
    'def world() -> E.World<U32,U32>: E.World{reset,view,step}',''];
  if((ranked.length+1)*ranked.length<=2**32)out.push(
    'def rank(obs: U32) -> U32: P.rank(~at,'+rankAt+','+ranked.length+',obs)','',
    'def history_world() -> E.World<H.State<U32,H.Previous>,U32>:',
    '  H.wrap(~U32, ~U32, ~H.Previous, ~U32, ~reset, ~view, ~step, ~H.First{},',
    '         ~(h => o => H.history_id(~rank, '+ranked.length+', h, o)), ~H.remember_previous)','');
  return out.join('\n');
}
