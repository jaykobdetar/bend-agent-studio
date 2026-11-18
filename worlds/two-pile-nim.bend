import Base
import ../arena.bend as A
import ../engine.bend as E
import ../parameters.bend as P

# Normal-play two-pile Nim. An action removes 1..3 from exactly one
# pile. Left removals are 1..3; right removals are 5..7.
type State is Data:
  Piles{left: U32,right: U32,second: Bool}

def Observation() -> Data: A.Signal

def legal(n: U32,+offset: U32,tail: List<&2,U32>) -> List<&2,U32>:
  match n:
    case 0: tail
    case 1: U32.add(offset,1) <> tail
    case 2: U32.add(offset,1) <> U32.add(offset,2) <> tail
    case _: U32.add(offset,1) <> U32.add(offset,2) <> U32.add(offset,3) <> tail

def position(s: State) -> A.Position:
  match s:
    case Piles{0,0,second}: A.Outcome{Bool.pick(F32,second,1.0,F32.neg(1.0))}
    case Piles{+l,+r,second}: A.Turn{second,U32.add(U32.mul(4,l),r),legal(l,0,legal(r,4,[]))}

def move(s: State,action: U32,word: U32) -> State:
  Piles{+l,+r,+second}=s
  +a=action
  Bool.pick(State,U32.is_lt(a,4),Piles{U32.sub(l,a),r,Bool.not(second)},Piles{l,U32.sub(r,U32.sub(a,4)),Bool.not(second)})

def size(v: F32) -> U32: F32.to_u32(F32.max(1.0,F32.min(3.0,v)))

def world(+p: P.Parameters) -> E.World<State,Observation>:
  +l=size(P.get(p,"left",2.0))
  +r=size(P.get(p,"right",3.0))
  A.world(~State,~position,~move,seed => Piles{l,r,False{}})
