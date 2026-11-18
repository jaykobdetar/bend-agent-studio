import Base
import ../engine.bend as E
import ../parameters.bend as P
import ../tabular.bend as T

type Pending is Data:
  Clear{}
  Waiting{obs: U32, action: U32, reward: F32}

type Model is Data:
  Agent{table: T.Table, pending: Pending, alpha: F32, gamma: F32}

def unit(x: F32) -> F32: F32.max(0.0,F32.min(1.0,x))

def initial(seed: U32, +p: P.Parameters) -> Model:
  Agent{[],Clear{},unit(P.get(p,"alpha",0.25)),unit(P.get(p,"gamma",0.9))}

def act(m: Model, s: U32, legal: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  Agent{q,p,a,g}=m
  T.epsilon_greedy(q,s,legal,mode,word)

def update(+q: T.Table,+s: U32,+a: U32,target: F32,alpha: F32) -> T.Table:
  +old=T.lookup(q,s,a)
  v=F32.add(old,F32.mul(alpha,F32.sub(target,old)))
  T.store(q,s,a,T.Cell{U32.add(T.visits(q,s,a),1),v})

def resolve(p: Pending,q: T.Table,future: F32,alpha: F32,gamma: F32) -> T.Table:
  match p:
    case Clear{}: q
    case Waiting{s,a,r}: update(q,s,a,F32.add(r,F32.mul(gamma,future)),alpha)

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

def accept(next: E.View<U32>,truncated: Bool,p: Pending,+q: T.Table,+alpha: F32,+gamma: F32) -> Model:
  match next truncated:
    case E.End{s} _: Agent{resolve(p,q,0.0,alpha,gamma),Clear{},alpha,gamma}
    case E.Open{s,legal} True{}: Agent{resolve(p,q,expected(q,s,legal),alpha,gamma),Clear{},alpha,gamma}
    case E.Open{s,legal} False{}: Agent{q,p,alpha,gamma}

def learn(m: Model,event: E.Transition<U32>) -> Model:
  Agent{+q,p,+alpha,+gamma}=m
  E.Transition{+s,+a,r,next,truncated}=event
  updated=resolve(p,q,T.lookup(q,s,a),alpha,gamma)
  accept(next,truncated,Waiting{s,a,r},updated,alpha,gamma)

def finish(m: Model,reason: E.Stop) -> Model:
  Agent{q,p,+alpha,+gamma}=m
  Agent{resolve(p,q,0.0,alpha,gamma),Clear{},alpha,gamma}

def pending(m: Model) -> Pending:
  Agent{q,p,a,g}=m
  p
