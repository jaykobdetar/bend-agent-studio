import Base
import ../core/arena.bend as A
import ../core/engine.bend as E
import ../core/parameters.bend as P

type State is Data:
  Pile{left: U32, second: Bool}

def Observation() -> Data: A.Signal

def position(state: State) -> A.Position:
  match state:
    case Pile{0,second}: A.Outcome{Bool.pick(F32,second,1.0,F32.neg(1.0))}
    case Pile{1,s}: A.Turn{s,1,[1]}
    case Pile{2,s}: A.Turn{s,2,[1,2]}
    case Pile{n,s}: A.Turn{s,n,[1,2,3]}

def move(state: State, action: U32, word: U32) -> State:
  Pile{n,s}=state
  Pile{U32.sub(n,action),Bool.not(s)}

def world(p: P.Parameters) -> E.World<State,Observation>:
  stones=F32.to_u32(F32.max(1.0,F32.min(1000.0,P.get(p,"stones",11.0))))
  A.world(~State,~position,~move,seed => Pile{stones,False{}})
