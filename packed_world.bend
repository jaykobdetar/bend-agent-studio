import Base
import ./engine.bend as E

# Three BMP private-use characters encode a U32, high group first (10/11/11).
# Strings stay compact literals in the Bend compiler rather than term trees.
def triple(s: String) -> U32:
  match s:
    case SCon{a,SCon{b,SCon{c,tail}}}:
      U32.add(U32.mul(U32.and(Char.to_u32(a),1023),4194304),
              U32.add(U32.mul(U32.and(Char.to_u32(b),2047),2048),U32.and(Char.to_u32(c),2047)))
    case _: 0

def page_word(s: String, offset: U32) -> U32:
  triple(String.drop(s,U32.to_nat(U32.mul(offset,3))))

def as_float(w: U32) -> F32:
  U32{x} = w
  F32{x}

def stop(done: Bool, value: U32, more: Unit -> U32) -> U32:
  match done:
    case True{}: value
    case False{}: more(Unit{})

# Lower bound on the first word of equally spaced records. Width is U32,
# so 33 binary decisions suffice, including the empty interval.
def bounds(~at: U32 -> U32, fuel: Nat, +base: U32, +stride: U32,
           +lo: U32, +hi: U32, +key: U32) -> U32:
  match fuel:
    case 0n: lo
    case 1n+rest:
      +mid = U32.add(lo,U32.div(U32.sub(hi,lo),2))
      +less = U32.is_lt(at(U32.add(base,U32.mul(mid,stride))),key)
      stop(U32.is_eq(lo,hi),lo,u => bounds(~at,rest,base,stride,
        Bool.pick(U32,less,U32.add(mid,1),lo), Bool.pick(U32,less,hi,mid),key))

def sampled(~at: U32 -> U32, +base: U32, count: U32, word: U32) -> Pair(U32,F32):
  +p = U32.add(base,U32.mul(3,bounds(~at,33n,base,3,0,count,word)))
  (at(U32.add(p,1)),as_float(at(U32.add(p,2))))

# Most large deterministic tables have one outcome per action.
def draw(~at: U32 -> U32, +base: U32, count: U32, word: U32) -> Pair(U32,F32):
  match count:
    case 1: (at(U32.add(base,1)),as_float(at(U32.add(base,2))))
    case n: sampled(~at,base,n,word)

def index(~at: U32 -> U32, n: U32, +prefix: U32, +key: U32) -> U32:
  stop(U32.is_lt(key,prefix),key,u => bounds(~at,33n,0,4,prefix,n,key))

def destination(pair: Pair(U32,F32)) -> U32:
  (id,reward) = pair
  id

def legal(~at: U32 -> U32, n: Nat, +p: U32) -> List<&2,U32>:
  match n:
    case 0n: []
    case 1n+rest: at(p) <> legal(~at,rest,U32.add(p,3))

def present(~at: U32 -> U32, obs: U32, actions: U32, offset: U32) -> E.View<U32>:
  match actions:
    case 0: E.End{obs}
    case n: E.Open{obs,legal(~at,U32.to_nat(n),offset)}

def show(~at: U32 -> U32, hit: Bool, state: U32, +row: U32) -> E.View<U32>:
  match hit:
    case False{}: E.End{state}
    case True{}: present(~at,at(U32.add(row,1)),at(U32.add(row,2)),at(U32.add(row,3)))

def view(~at: U32 -> U32, +n: U32, prefix: U32, +state: U32) -> E.View<U32>:
  +i = index(~at,n,prefix,state)
  +row = U32.mul(i,4)
  show(~at,U32.is_lt(i,n) && U32.is_eq(at(row),state),state,row)

def choose(hit: Bool, yes: Unit -> Pair(U32,F32), no: Unit -> Pair(U32,F32)) -> Pair(U32,F32):
  match hit:
    case True{}: yes(Unit{})
    case False{}: no(Unit{})

def action(~at: U32 -> U32, n: Nat, +p: U32, state: U32, +a: U32, +word: U32) -> Pair(U32,F32):
  match n:
    case 0n: (state,0.0)
    case 1n+rest:
      choose(U32.is_eq(at(p),a),u => draw(~at,at(U32.add(p,2)),at(U32.add(p,1)),word),
        u => action(~at,rest,U32.add(p,3),state,a,word))

def step(~at: U32 -> U32, +n: U32, prefix: U32, +state: U32, a: U32, word: U32) -> Pair(U32,F32):
  +i = index(~at,n,prefix,state)
  +row = U32.mul(i,4)
  choose(U32.is_lt(i,n) && U32.is_eq(at(row),state),
    u => action(~at,U32.to_nat(at(U32.add(row,2))),at(U32.add(row,3)),state,a,word),
    u => (state,0.0))

def rank(~at: U32 -> U32, +base: U32, +n: U32, +obs: U32) -> U32:
  +i = bounds(~at,33n,base,1,0,n,obs)
  Bool.pick(U32,U32.is_lt(i,n) && U32.is_eq(at(U32.add(base,i)),obs),i,0)
