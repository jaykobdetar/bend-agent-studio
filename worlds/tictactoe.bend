import Base
import ../arena.bend as A
import ../engine.bend as E
import ../parameters.bend as P

type State is Data:
  Board{x: U32, o: U32, second: Bool, symmetry: Bool}

def Observation() -> Data: A.Signal

def won(+b: U32) -> Bool:
  U32.is_eq(U32.and(b,7),7) || U32.is_eq(U32.and(b,56),56) || U32.is_eq(U32.and(b,448),448) ||
  U32.is_eq(U32.and(b,73),73) || U32.is_eq(U32.and(b,146),146) || U32.is_eq(U32.and(b,292),292) ||
  U32.is_eq(U32.and(b,273),273) || U32.is_eq(U32.and(b,84),84)

# Bit index 3*row+column. Rotate clockwise and reflect across the vertical axis.
def rotate(+b: U32) -> U32:
  U32.or(U32.shrn(U32.and(b,64),6n),
    U32.or(U32.shrn(U32.and(b,128),4n),
    U32.or(U32.shrn(U32.and(b,264),2n),
    U32.or(U32.and(b,16),
    U32.or(U32.shln(U32.and(b,33),2n),
    U32.or(U32.shln(U32.and(b,2),4n),
    U32.shln(U32.and(b,4),6n)))))))

def mirror(+b: U32) -> U32:
  U32.or(U32.shrn(U32.and(b,292),2n),
    U32.or(U32.and(b,146),
    U32.shln(U32.and(b,73),2n)))

type Orientation is Data:
  Orientation{key: U32, occupied: U32, pose: U32}

def candidate(+own: U32,+other: U32,pose: U32) -> Orientation:
  Orientation{U32.or(U32.shln(own,9n),other),U32.or(own,other),pose}

def earlier(a: Orientation,b: Orientation) -> Orientation:
  match a b:
    case Orientation{+ka,ma,sa} Orientation{+kb,mb,sb}:
      Bool.pick(Orientation,U32.is_le(ka,kb),Orientation{ka,ma,sa},Orientation{kb,mb,sb})

def four(+own: U32,+other: U32,+base: U32) -> Orientation:
  +a=rotate(own)
  +b=rotate(other)
  +c=rotate(a)
  +d=rotate(b)
  earlier(candidate(own,other,base),earlier(candidate(a,b,U32.add(base,1)),
    earlier(candidate(c,d,U32.add(base,2)),candidate(rotate(c),rotate(d),U32.add(base,3)))))

def orient(symmetry: Bool,+own: U32,+other: U32) -> Orientation:
  match symmetry:
    case False{}: candidate(own,other,0)
    case True{}: earlier(four(own,other,0),four(mirror(own),mirror(other),4))

def orientation(+x: U32,+o: U32,+second: Bool,symmetry: Bool) -> Orientation:
  orient(symmetry,Bool.pick(U32,second,o,x),Bool.pick(U32,second,x,o))

def legal(n: Nat,+mask: U32,tail: List<&2,U32>) -> List<&2,U32>:
  match n:
    case 0n: tail
    case 1n++i:
      +rest=tail
      open=U32.is_eq(U32.and(mask,U32.shln(1,i)),0)
      legal(i,mask,Bool.pick(List<&2,U32>,open,U32.from_nat(i) <> rest,rest))

def active(second: Bool, frame: Orientation) -> A.Position:
  Orientation{key,mask,pose}=frame
  A.Turn{second,key,legal(9n,mask,[])}

def result(xwins: Bool,owins: Bool,full: Bool,+x: U32,+o: U32,+s: Bool,sym: Bool) -> A.Position:
  match xwins owins full:
    case True{} _ _: A.Outcome{1.0}
    case _ True{} _: A.Outcome{F32.neg(1.0)}
    case _ _ True{}: A.Outcome{0.0}
    case _ _ _: active(s,orientation(x,o,s,sym))

def position(state: State) -> A.Position:
  Board{+x,+o,s,sym}=state
  result(won(x),won(o),U32.is_eq(U32.or(x,o),511),x,o,s,sym)

def rotate_id(+i: U32) -> U32:
  U32.add(U32.mul(3,U32.mod(i,3)),U32.sub(2,U32.div(i,3)))

def mirror_id(+i: U32) -> U32:
  U32.add(U32.mul(3,U32.div(i,3)),U32.sub(2,U32.mod(i,3)))

def spin(times: U32,i: U32) -> U32:
  match times:
    case 0: i
    case 1: rotate_id(i)
    case 2: rotate_id(rotate_id(i))
    case _: rotate_id(rotate_id(rotate_id(i)))

def inverse(frame: Orientation, action: U32) -> U32:
  Orientation{k,mask,+pose}=frame
  +unrotated=spin(U32.and(U32.sub(4,U32.and(pose,3)),3),action)
  Bool.pick(U32,U32.is_ge(pose,4),mirror_id(unrotated),unrotated)

def mark(second: Bool,x: U32,o: U32,symmetry: Bool,cell: U32) -> State:
  match second:
    case False{}: Board{U32.or(x,U32.shln(1,U32.to_nat(cell))),o,True{},symmetry}
    case True{}: Board{x,U32.or(o,U32.shln(1,U32.to_nat(cell))),False{},symmetry}

def move(state: State, action: U32, word: U32) -> State:
  Board{+x,+o,+s,+sym}=state
  mark(s,x,o,sym,inverse(orientation(x,o,s,sym),action))

def world(p: P.Parameters) -> E.World<State,Observation>:
  symmetry=F32.is_gt(P.get(p,"symmetry",1.0),0.0)
  A.world(~State,~position,~move,seed => Board{0,0,False{},symmetry})
