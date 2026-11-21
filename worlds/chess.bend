import Base
import ../core/arena.bend as A
import ../core/engine.bend as E
import ../core/parameters.bend as P

# 0x88 coordinates: a1=0, h1=7, a8=112. Ranks are packed into nibbles.
# Pieces: 1..6 pawn, knight, bishop, rook, queen, king; black adds 8.
type Board is Data:
  Ranks{a: U32,b: U32,c: U32,d: U32,e: U32,f: U32,g: U32,h: U32}

type State is Data:
  Chess{board: Board, side: U32, rights: U32, ep: U32, white: U32, black: U32, clock: U32}

def Observation() -> Data: A.Signal

def rank(s: U32) -> U32: U32.shrn(s,4n)
def shift(s: U32) -> Nat: U32.to_nat(U32.mul(U32.and(s,7),4))
def square(s: U32) -> Bool: U32.is_eq(U32.and(s,136),0)
def kind(p: U32) -> U32: U32.and(p,7)
def color(p: U32) -> U32: U32.and(p,8)
def add(+s: U32,d: U32) -> U32: U32.sub(U32.add(s,d),64)
def rank_at(board: Board,r: U32) -> U32:
  Ranks{a,b,c,d,e,f,g,h}=board
  match r:
    case 0: a
    case 1: b
    case 2: c
    case 3: d
    case 4: e
    case 5: f
    case 6: g
    case _: h

def get(board: Board,+s: U32) -> U32:
  U32.and(U32.shrn(rank_at(board,rank(s)),shift(s)),15)

def set_rank(board: Board,r: U32,v: U32) -> Board:
  Ranks{a,b,c,d,e,f,g,h}=board
  match r:
    case 0: Ranks{v,b,c,d,e,f,g,h}
    case 1: Ranks{a,v,c,d,e,f,g,h}
    case 2: Ranks{a,b,v,d,e,f,g,h}
    case 3: Ranks{a,b,c,v,e,f,g,h}
    case 4: Ranks{a,b,c,d,v,f,g,h}
    case 5: Ranks{a,b,c,d,e,v,g,h}
    case 6: Ranks{a,b,c,d,e,f,v,h}
    case _: Ranks{a,b,c,d,e,f,g,v}

def set(+board: Board,+s: U32,p: U32) -> Board:
  +n=shift(s)
  +r=rank(s)
  v=U32.or(U32.and(rank_at(board,r),U32.xor(U32.shln(15,n),4294967295)),U32.shln(p,n))
  set_rank(board,r,v)

def diag() -> List<&2,U32>: [47,49,79,81]
def orth() -> List<&2,U32>: [48,63,65,80]
def adjacent() -> List<&2,U32>: [47,48,49,63,65,79,80,81]
def horses() -> List<&2,U32>: [31,33,46,50,78,82,95,97]
def forward(side: U32) -> U32: Bool.pick(U32,U32.is_eq(side,0),80,48)

def sees(board: Board,+t: U32,p: U32) -> Bool:
  square(t) && U32.is_eq(get(board,t),p)

def jumps(+board: Board,+s: U32,+p: U32,ds: List<&2,U32>) -> Bool:
  match ds:
    case []: False{}
    case d<>rest: sees(board,add(s,d),p) || jumps(board,s,p,rest)

def ray_piece(+p: U32,enemy: U32,piece: U32,more: Bool -> Bool) -> Bool:
  match p:
    case 0: more(True{})
    case _: U32.is_eq(color(p),enemy) && (U32.is_eq(kind(p),piece) || U32.is_eq(kind(p),5))

def ray_bound(valid: Bool,more: Bool -> Bool) -> Bool:
  match valid:
    case False{}: False{}
    case True{}: more(True{})

def ray_hit(fuel: Nat,+board: Board,+t: U32,+d: U32,+enemy: U32,+piece: U32) -> Bool:
  match fuel:
    case 0n: False{}
    case 1n+left: ray_bound(square(t),go => ray_piece(get(board,t),enemy,piece,
      next => ray_hit(left,board,add(t,d),d,enemy,piece)))

def rays(+board: Board,+s: U32,+enemy: U32,+piece: U32,ds: List<&2,U32>) -> Bool:
  match ds:
    case []: False{}
    case +d<>rest: ray_hit(7n,board,add(s,d),d,enemy,piece) || rays(board,s,enemy,piece,rest)

def attacked(+board: Board,+s: U32,+enemy: U32) -> Bool:
  +back=U32.sub(128,forward(enemy))
  sees(board,add(s,U32.sub(back,1)),U32.add(enemy,1)) ||
  sees(board,add(s,U32.add(back,1)),U32.add(enemy,1)) ||
  jumps(board,s,U32.add(enemy,2),horses()) ||
  jumps(board,s,U32.add(enemy,6),adjacent()) ||
  rays(board,s,enemy,3,diag()) || rays(board,s,enemy,4,orth())

# Stable archive action: from + 128*to + 16384*promotion kind.
def encode(from: U32,to: U32,p: U32) -> U32:
  U32.add(from,U32.add(U32.shln(to,7n),U32.shln(p,14n)))

def mask(s: U32) -> U32:
  match s:
    case 0: 13
    case 4: 12
    case 7: 14
    case 112: 7
    case 116: 3
    case 119: 11
    case _: 15

def place_rook(delta: U32,board: Board,side: U32,+from: U32) -> Board:
  match delta:
    case 2: set(set(board,U32.add(from,3),0),U32.add(from,1),U32.add(side,4))
    case 4294967294: set(set(board,U32.sub(from,4),0),U32.sub(from,1),U32.add(side,4))
    case _: board

def apply_kind(piece: U32,+b: Board,+side: U32,+from: U32,+to: U32,taken: U32) -> Board:
  match piece:
    case 6: place_rook(U32.sub(to,from),b,side,from)
    case 1:
      Bool.pick(Board,U32.is_eq(taken,0) && Bool.not(U32.is_eq(U32.and(from,7),U32.and(to,7))),
        set(b,add(to,U32.sub(128,forward(side))),0),b)
    case _: b

def apply(board: Board,+side: U32,+from: U32,+to: U32,+prom: U32,+p: U32,taken: U32) -> Board:
  b=set(set(board,from,0),to,Bool.pick(U32,U32.is_eq(prom,0),p,U32.add(side,prom)))
  apply_kind(kind(p),b,side,from,to,taken)

def destination(a: U32) -> U32: U32.and(U32.shrn(a,7n),127)
def source(a: U32) -> U32: U32.and(a,127)

def move(state: State,+action: U32,word: U32) -> State:
  Chess{+board,+side,rights,ep,+white,+black,clock}=state
  +from=source(action)
  +to=destination(action)
  +p=get(board,from)
  +taken=get(board,to)
  +pawn=U32.is_eq(kind(p),1)
  +king=U32.is_eq(kind(p),6)
  +enemy=U32.xor(side,8)
  target=Bool.pick(U32,pawn && U32.is_eq(to,add(add(from,forward(side)),forward(side))),add(from,forward(side)),127)
  Chess{apply(board,side,from,to,U32.shrn(action,14n),p,taken),enemy,
    U32.and(rights,U32.and(mask(from),mask(to))),target,
    Bool.pick(U32,king && U32.is_eq(side,0),to,white),
    Bool.pick(U32,king && U32.is_eq(side,8),to,black),
    Bool.pick(U32,pawn || Bool.not(U32.is_eq(taken,0)),0,U32.add(clock,1))}

def safe(+board: Board,+side: U32,+k: U32,+a: U32) -> Bool:
  +f=source(a)
  +t=destination(a)
  +p=get(board,f)
  next=apply(board,side,f,t,U32.shrn(a,14n),p,get(board,t))
  Bool.not(attacked(next,Bool.pick(U32,U32.is_eq(kind(p),6),t,k),U32.xor(side,8)))

def empty(board: Board,+s: U32) -> Bool: square(s) && U32.is_eq(get(board,s),0)

def promote(on: Bool,+f: U32,+t: U32,tail: List<&2,U32>) -> List<&2,U32>:
  match on:
    case True{}: encode(f,t,5) <> encode(f,t,4) <> encode(f,t,3) <> encode(f,t,2) <> tail
    case False{}: encode(f,t,0) <> tail

def push(f: U32,+t: U32,tail: List<&2,U32>) -> List<&2,U32>:
  promote(U32.is_eq(rank(t),0) || U32.is_eq(rank(t),7),f,t,tail)

def pawn_take(+board: Board,side: U32,ep: U32,f: U32,+t: U32,+tail: List<&2,U32>) -> List<&2,U32>:
  +p=get(board,t)
  valid=square(t) && (U32.is_eq(t,ep) || (U32.is_eq(color(p),U32.xor(side,8)) && Bool.not(U32.is_eq(p,0)) && Bool.not(U32.is_eq(kind(p),6))))
  Bool.pick(List<&2,U32>,valid,push(f,t,tail),tail)

def pawn_clear(on: Bool,board: Board,+side: U32,+f: U32,+t: U32,tail: List<&2,U32>) -> List<&2,U32>:
  match on:
    case False{}: tail
    case True{}:
      +u=add(t,forward(side))
      +rest=push(f,t,tail)
      twice=U32.is_eq(rank(f),Bool.pick(U32,U32.is_eq(side,0),1,6)) && empty(board,u)
      Bool.pick(List<&2,U32>,twice,encode(f,u,0) <> rest,rest)

def pawn_run(+board: Board,side: U32,f: U32,+t: U32,tail: List<&2,U32>) -> List<&2,U32>:
  pawn_clear(empty(board,t),board,side,f,t,tail)

def slide_more(again: Bool,rest: List<&2,U32>,more: List<&2,U32> -> List<&2,U32>) -> List<&2,U32>:
  match again:
    case False{}: rest
    case True{}: more(rest)

def slide_piece(+p: U32,side: U32,a: U32,+again: Bool,+tail: List<&2,U32>,more: List<&2,U32> -> List<&2,U32>) -> List<&2,U32>:
  match p:
    case 0: slide_more(again,a <> tail,more)
    case _:
      valid=Bool.not(U32.is_eq(color(p),side)) && Bool.not(U32.is_eq(kind(p),6))
      Bool.pick(List<&2,U32>,valid,a <> tail,tail)

def slide_bound(inside: Bool,tail: List<&2,U32>,go: List<&2,U32> -> List<&2,U32>) -> List<&2,U32>:
  match inside:
    case False{}: tail
    case True{}: go(tail)

def slide(fuel: Nat,+board: Board,+side: U32,+f: U32,+t: U32,+d: U32,+again: Bool,tail: List<&2,U32>) -> List<&2,U32>:
  match fuel:
    case 0n: tail
    case 1n+left: slide_bound(square(t),tail,rest => slide_piece(get(board,t),side,encode(f,t,0),again,rest,
      next => slide(left,board,side,f,add(t,d),d,again,next)))

def gen_dirs(+board: Board,+side: U32,+f: U32,+again: Bool,dirs: List<&2,U32>,tail: List<&2,U32>) -> List<&2,U32>:
  match dirs:
    case []: tail
    case +d<>rest: gen_dirs(board,side,f,again,rest,slide(7n,board,side,f,add(f,d),d,again,tail))

def castle_clear(on: Bool,+board: Board,+side: U32,+rights: U32,+f: U32,+tail: List<&2,U32>) -> List<&2,U32>:
  match on:
    case False{}: tail
    case True{}:
      +short=Bool.pick(U32,U32.is_eq(side,0),1,4)
      +long=U32.mul(short,2)
      +s=U32.add(f,1)
      +l=U32.sub(f,1)
      +ks=Bool.not(U32.is_eq(U32.and(rights,short),0)) && U32.is_eq(get(board,U32.add(f,3)),U32.add(side,4)) &&
        empty(board,s) && empty(board,U32.add(f,2)) && safe(board,side,f,encode(f,s,0))
      qs=Bool.not(U32.is_eq(U32.and(rights,long),0)) && U32.is_eq(get(board,U32.sub(f,4)),U32.add(side,4)) &&
        empty(board,l) && empty(board,U32.sub(f,2)) && empty(board,U32.sub(f,3)) && safe(board,side,f,encode(f,l,0))
      +rest=Bool.pick(List<&2,U32>,ks,encode(f,U32.add(f,2),0) <> tail,tail)
      Bool.pick(List<&2,U32>,qs,encode(f,U32.sub(f,2),0) <> rest,rest)

def castles(+board: Board,+side: U32,+rights: U32,+f: U32,tail: List<&2,U32>) -> List<&2,U32>:
  home=Bool.pick(U32,U32.is_eq(side,0),4,116)
  valid=U32.is_eq(f,home) && Bool.not(U32.is_eq(rights,0)) && Bool.not(attacked(board,f,U32.xor(side,8)))
  castle_clear(valid,board,side,rights,f,tail)

def gen_piece(piece: U32,+board: Board,+side: U32,rights: U32,+ep: U32,+f: U32,tail: List<&2,U32>) -> List<&2,U32>:
  match piece:
    case 1:
      +t=add(f,forward(side))
      pawn_take(board,side,ep,f,U32.add(t,1),
        pawn_take(board,side,ep,f,U32.sub(t,1),pawn_run(board,side,f,t,tail)))
    case 2: gen_dirs(board,side,f,False{},horses(),tail)
    case 3: gen_dirs(board,side,f,True{},diag(),tail)
    case 4: gen_dirs(board,side,f,True{},orth(),tail)
    case 5: gen_dirs(board,side,f,True{},adjacent(),tail)
    case _: gen_dirs(board,side,f,False{},adjacent(),castles(board,side,rights,f,tail))

def scan(owner: Bool,tail: List<&2,U32>,go: List<&2,U32> -> List<&2,U32>) -> List<&2,U32>:
  match owner:
    case True{}: go(tail)
    case False{}: tail

def pseudo(+board: Board,+side: U32,+rights: U32,+ep: U32,i: Nat,tail: List<&2,U32>) -> List<&2,U32>:
  match i:
    case 0n: tail
    case 1n++j:
      +n=U32.from_nat(j)
      +f=U32.add(U32.and(n,7),U32.shln(U32.shrn(n,3n),4n))
      +p=get(board,f)
      next=scan(Bool.not(U32.is_eq(p,0)) && U32.is_eq(color(p),side),tail,rest => gen_piece(kind(p),board,side,rights,ep,f,rest))
      pseudo(board,side,rights,ep,j,next)

def keep(+board: Board,+side: U32,+k: U32,moves: List<&2,U32>) -> List<&2,U32>:
  match moves:
    case []: []
    case +a<>rest:
      +next=keep(board,side,k,rest)
      Bool.pick(List<&2,U32>,safe(board,side,k,a),a <> next,next)

def legal(state: State) -> List<&2,U32>:
  Chess{+board,+side,rights,ep,white,black,clock}=state
  keep(board,side,Bool.pick(U32,U32.is_eq(side,0),white,black),pseudo(board,side,rights,ep,64n,[]))

def hash(+board: Board,i: Nat,+h: U32) -> U32:
  match i:
    case 0n: h
    case 1n++j: hash(board,j,E.mix_word(U32.xor(rank_at(board,U32.from_nat(j)),h)))

# Recognize the common dead positions without pretending to solve all
# blocked-board cases: kings only, one minor, or bishops on one square color.
# Bits 0..1 encode the bishop colors, bit 2 a knight, bit 3 mating material.
def add_material(piece: U32,+f: U32,+seen: U32) -> U32:
  match piece:
    case 0: seen
    case 6: seen
    case 2: Bool.pick(U32,U32.is_eq(seen,0),4,8)
    case 3:
      +colorbit=U32.shln(1,U32.to_nat(U32.and(U32.add(rank(f),U32.and(f,7)),1)))
      Bool.pick(U32,U32.is_lt(seen,4),U32.or(seen,colorbit),8)
    case _: 8

def material(i: Nat,+board: Board,seen: U32) -> U32:
  match i:
    case 0n: seen
    case 1n++j:
      +n=U32.from_nat(j)
      +f=U32.add(U32.and(n,7),U32.shln(U32.shrn(n,3n),4n))
      material(j,board,add_material(kind(get(board,f)),f,seen))

def reported_dead(+n: U32) -> Bool:
  Bool.not(U32.is_eq(n,3)) && U32.is_lt(n,8)

def dead(board: Board) -> Bool:
  reported_dead(material(64n,board,0))

def active(draw: Bool,second: Bool,key: U32,moves: List<&2,U32>) -> A.Position:
  match draw:
    case True{}: A.Outcome{0.0}
    case False{}: A.Turn{second,key,moves}

def result(moves: List<&2,U32>,state: State) -> A.Position:
  match moves state:
    case [] Chess{board,+side,rights,ep,white,black,clock}:
      +second=U32.is_eq(side,8)
      on=attacked(board,Bool.pick(U32,second,black,white),U32.xor(side,8))
      A.Outcome{Bool.pick(F32,on,Bool.pick(F32,second,1.0,F32.neg(1.0)),0.0)}
    case moves Chess{+board,+side,rights,ep,white,black,+clock}:
      key=hash(board,8n,U32.add(clock,U32.shln(U32.add(side,U32.shln(U32.add(rights,U32.shln(ep,4n)),4n)),8n)))
      active(U32.is_ge(clock,150) || dead(board),U32.is_eq(side,8),key,moves)

def position(+state: State) -> A.Position:
  result(legal(state),state)

def start() -> State:
  Chess{Ranks{1110856484,286331153,0,0,0,0,2576980377,3401505708},0,15,127,4,116,0}

def world(p: P.Parameters) -> E.World<State,Observation>:
  A.world(~State,~(s => position(s)),~(s => a => w => move(s,a,w)),seed => start())
