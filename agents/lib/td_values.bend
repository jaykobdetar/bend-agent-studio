import Base
import ../../tabular.bend as T

def unit(x: F32) -> F32: F32.max(0.0,F32.min(1.0,x))

def update(+q: T.Table,+s: U32,+a: U32,target: F32,alpha: F32) -> T.Table:
  +old=T.lookup(q,s,a)
  v=F32.add(old,F32.mul(alpha,F32.sub(target,old)))
  T.store(q,s,a,T.Cell{U32.add(T.visits(q,s,a),1),v})

# Exploratory quarter: T.random_action selects (word >> 2) % count.
# The first 2^30 % count indices have one additional word.
def weighted(xs: List<&2,U32>,+q: T.Table,+s: U32,+base: U32,+extra: U32,+i: U32) -> F32:
  match xs:
    case Nil{}: 0.0
    case a <> rest:
      n=U32.add(base,Bool.pick(U32,U32.is_lt(i,extra),1,0))
      F32.add(F32.mul(F32.div(U32.to_f32(n),1073741824.0),T.lookup(q,s,a)),weighted(rest,q,s,base,extra,U32.add(i,1)))

def expected(+q: T.Table,+s: U32,+xs: List<&2,U32>) -> F32:
  +n=U32.max(1,U32.from_nat(List.length(&2,U32,xs)))
  explore=weighted(xs,q,s,U32.div(1073741824,n),U32.mod(1073741824,n),0)
  greedy=T.lookup(q,s,T.best_action(T.choices(xs,q,s)))
  F32.add(F32.mul(0.75,greedy),F32.mul(0.25,explore))

