import Base
import ../../../core/engine.bend as E
import ../../../core/parameters.bend as P
import ../../../worlds/challenges/switchboard/switchboard.bend as S

# Keep the published world and public observation exactly as-is. Only the
# answer's terminal score changes: query i selects (5*i+3) mod 16; invert
# targets for i mod 4 in {1,2}. The agent does not import this module.
def State() -> Data: S.State
def Observation() -> Data: S.Observation

def terminal(mask: U32,+i: U32,action: U32,memory: U32,width: U32,delay: U32,encoding: U32) -> Pair(State,F32):
  +residue=U32.mod(i,4)
  invert=Bool.to_u32(U32.is_eq(residue,1) || U32.is_eq(residue,2))
  target=U32.xor(S.bit_at(mask,U32.mod(U32.add(U32.mul(5,i),3),16)),invert)
  (S.Panel{S.PanelDone{},memory,width,delay,encoding},
    Bool.pick(F32,U32.is_eq(action,target),1.0,F32.neg(1.0)))

def step(panel: State,action: U32,word: U32) -> Pair(State,F32):
  match panel:
    case S.Panel{S.PanelAsk{mask,i},memory,width,delay,encoding}: terminal(mask,i,action,memory,width,delay,encoding)
    case other: S.advance(other,action,word)

def with_remapped_reward(base: E.World<State,Observation>) -> E.World<State,Observation>:
  E.World{reset,inspect,advance}=base
  E.World{reset,inspect,step}

def world(params: P.Parameters) -> E.World<State,Observation>:
  with_remapped_reward(S.world(params))
