import Base
import ../../../core/engine.bend as E
import ../../../core/history.bend as H
import ../../../core/parameters.bend as P
import ../../../worlds/challenges/switchboard/switchboard.bend as S

# Keep the shipped width-16, zero-blank task. Replace only the public encoder.
type State is Data:
  Suffix{hidden: S.Hidden, memory: U32, keep: U32}

def Observation() -> Data: U32

def remember(keep: U32,+memory: U32,+before: U32) -> U32:
  updated=U32.and(keep,U32.or(U32.shln(memory,1n),U32.and(before,1)))
  Bool.pick(U32,U32.is_lt(before,32),updated,memory)

def inspect(panel: State) -> E.View<U32>:
  Suffix{hidden,memory,keep}=panel
  H.encode_view(U32,U32,U32,m => o => S.encode(16,m,o),memory,S.view(16,hidden))

def applied(memory: U32,keep: U32,result: Pair(S.Hidden,F32)) -> Pair(State,F32):
  (after,reward)=result
  (Suffix{after,memory,keep},reward)

def advance(panel: State,action: U32,word: U32) -> Pair(State,F32):
  Suffix{+hidden,memory,+keep}=panel
  before=H.observation(U32,S.view(16,hidden))
  applied(remember(keep,memory,before),keep,S.move(16,0,hidden,action,word))

def world(params: P.Parameters) -> E.World<State,Observation>:
  retained=F32.to_nat(F32.max(0.0,F32.min(16.0,P.get(params,"retain",0.0))))
  keep=U32.sub(U32.shln(1,retained),1)
  E.World{seed => Suffix{S.reset(seed),0,keep},inspect,advance}
