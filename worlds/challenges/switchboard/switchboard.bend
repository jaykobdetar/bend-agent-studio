import Base
import ../../../core/engine.bend as E
import ../../../core/history.bend as H
import ../../../core/parameters.bend as P

# Compact authored counterpart of switchboard.mjs. Private cue bits settle the
# answer; the memory encoder below sees only public cue observations.
type Hidden is Data:
  PanelCue{mask: U32, index: U32}
  PanelBlank{mask: U32, remaining: U32}
  PanelAsk{mask: U32, index: U32}
  PanelDone{}

type State is Data:
  Panel{hidden: Hidden, memory: U32, width: U32, delay: U32, encoding: U32}
def Observation() -> Data: U32

def bit_at(mask: U32,index: U32) -> U32:
  U32.and(U32.shrn(mask,U32.to_nat(index)),1)

def reset(seed: U32) -> Hidden:
  # Match the two ordered unit-weight buckets of the finite reset.
  PanelCue{U32.shrn(E.mix_word(U32.xor(seed,3266489917)),31n),0}

def view(+width: U32, state: Hidden) -> E.View<U32>:
  match state:
    case PanelCue{mask,+i}: E.Open{U32.add(U32.mul(2,i),bit_at(mask,i)),[2]}
    case PanelBlank{mask,remaining}: E.Open{U32.mul(2,width),[2]}
    case PanelAsk{mask,i}: E.Open{U32.add(U32.add(U32.mul(2,width),1),i),[0,1]}
    case PanelDone{}: E.End{U32.add(U32.mul(3,width),1)}

def drawn_query(width: U32,word: U32) -> U32:
  # Power-of-two equal buckets select the top 1, 2, 3, or 4 bits.
  match width:
    case 2: U32.shrn(word,31n)
    case 4: U32.shrn(word,30n)
    case 8: U32.shrn(word,29n)
    case _: U32.shrn(word,28n)

def after_cues(+width: U32,delay: U32,+mask: U32,word: U32) -> Hidden:
  match delay:
    case 0: PanelAsk{mask,drawn_query(width,word)}
    case +left: PanelBlank{mask,left}

def next_cue(+width: U32,+delay: U32,+mask: U32,+i: U32,+word: U32) -> Hidden:
  +j=U32.add(i,1)
  Bool.pick(Hidden,U32.is_lt(j,width),
    PanelCue{U32.or(mask,U32.shln(U32.shrn(word,31n),U32.to_nat(j))),j},
    after_cues(width,delay,mask,word))

def move(+width: U32,+delay: U32,state: Hidden,action: U32,word: U32) -> Pair(Hidden,F32):
  match state:
    case PanelCue{mask,i}: (next_cue(width,delay,mask,i,word),0.0)
    case PanelBlank{mask,remaining}:
      match remaining:
        case 1: (PanelAsk{mask,drawn_query(width,word)},0.0)
        case +left: (PanelBlank{mask,U32.sub(left,1)},0.0)
    case PanelAsk{mask,i}: (PanelDone{},Bool.pick(F32,U32.is_eq(action,bit_at(mask,i)),1.0,F32.neg(1.0)))
    case PanelDone{}: (PanelDone{},0.0)

def stride(width: U32) -> U32:
  U32.add(U32.mul(3,width),2)

def encode(width: U32,memory: U32,current: U32) -> U32:
  U32.add(U32.mul(stride(width),memory),current)

def remember_cue(encoding: U32,+memory: U32,+before: U32) -> U32:
  match encoding:
    case 1: U32.and(before,1)
    case 2: U32.or(memory,U32.shln(U32.and(before,1),U32.to_nat(U32.shr(before))))
    case _: 0

def remember(width: U32,encoding: U32,+memory: U32,+before: U32) -> U32:
  Bool.pick(U32,U32.is_lt(before,U32.mul(2,width)),remember_cue(encoding,memory,before),memory)

def supported_width(width: U32) -> U32:
  match width:
    case 4: 4
    case 8: 8
    case 16: 16
    case _: 2

def inspect(panel: State) -> E.View<U32>:
  Panel{hidden,memory,+width,delay,encoding}=panel
  H.encode_view(U32,U32,U32,m => o => encode(width,m,o),memory,view(width,hidden))

def applied(memory: U32,width: U32,delay: U32,encoding: U32,result: Pair(Hidden,F32)) -> Pair(State,F32):
  (after,reward)=result
  (Panel{after,memory,width,delay,encoding},reward)

def advance(panel: State,action: U32,word: U32) -> Pair(State,F32):
  Panel{+hidden,memory,+width,+delay,+encoding}=panel
  before=H.observation(U32,view(width,hidden))
  applied(remember(width,encoding,memory,before),width,delay,encoding,move(width,delay,hidden,action,word))

def world(params: P.Parameters) -> E.World<State,Observation>:
  +p=params
  +width=supported_width(F32.to_u32(F32.max(0.0,F32.min(16.0,P.get(p,"width",2.0)))))
  +delay=F32.to_u32(F32.max(0.0,F32.min(128.0,P.get(p,"delay",2.0))))
  encoding=F32.to_u32(F32.max(0.0,F32.min(2.0,P.get(p,"encoding",0.0))))
  E.World{seed => Panel{reset(seed),0,width,delay,encoding},inspect,advance}
