import Base
import ../../core/engine.bend as E
import ../../core/parameters.bend as P
import ../../core/tabular.bend as T
import ../lib/td_values.bend as V

type Trace is Data:
  Trace{feature: U32,action: U32,weight: F32}

def Traces() -> Data: List<&2,Trace>

type Config is Data:
  Config{linear: Bool,alpha: F32,gamma: F32,lambda: F32}

type Model is Data:
  Agent{weights: T.Table,traces: Traces,config: Config}

def initial(seed: U32,+p: P.Parameters) -> Model:
  Agent{[],[],Config{F32.is_ge(P.get(p,"linear",0.0),1.0),V.unit(P.get(p,"alpha",0.1)),V.unit(P.get(p,"gamma",0.9)),V.unit(P.get(p,"lambda",0.8))}}

# Linear features: action-specific bias and one state-bucket indicator.
def bucket(s: U32) -> U32: U32.add(1,U32.and(s,255))

def value(linear: Bool,+w: T.Table,s: U32,+a: U32) -> F32:
  match linear:
    case False{}: T.lookup(w,s,a)
    case True{}: F32.add(T.lookup(w,0,a),T.lookup(w,bucket(s),a))

def project(xs: List<&2,U32>,+linear: Bool,+w: T.Table,+s: U32) -> T.Table:
  match xs:
    case Nil{}: []
    case +a <> rest: T.store(project(rest,linear,w,s),s,a,T.Cell{0,value(linear,w,s,a)})

def act(m: Model,obs: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  Agent{w,tr,Config{linear,alpha,gamma,l}}=m
  +s=obs
  +xs=legal
  T.epsilon_greedy(project(xs,linear,w,s),s,xs,mode,word)

def future(next: E.View<U32>,linear: Bool,w: T.Table) -> F32:
  match next:
    case E.End{s}: 0.0
    case E.Open{+s,+xs}: V.expected(project(xs,linear,w,s),s,xs)

def touch(hit: Bool,f: U32,a: U32,v: F32,tail: Traces,more: Unit -> Traces) -> Traces:
  match hit:
    case True{}: Trace{f,a,F32.add(v,1.0)} <> tail
    case False{}: Trace{f,a,v} <> more(Unit{})

def bump(ts: Traces,+k: U32,+id: U32) -> Traces:
  match ts:
    case Nil{}: [Trace{k,id,1.0}]
    case Trace{+f,+a,v} <> +tail: touch(T.keyeq(f,a,k,id),f,a,v,tail,u => bump(tail,k,id))

def grad(linear: Bool,t: Traces,s: U32,+a: U32) -> Traces:
  match linear:
    case False{}: bump(t,s,a)
    case True{}: bump(bump(t,0,a),bucket(s),a)

def apply(ts: Traces,+w: T.Table,+rate: F32) -> T.Table:
  match ts:
    case Nil{}: w
    case Trace{+f,+a,v} <> tail:
      x=F32.add(T.lookup(w,f,a),F32.mul(rate,v))
      apply(tail,T.store(w,f,a,T.Cell{U32.add(T.visits(w,f,a),1),x}),rate)

def scaled(ts: Traces,+factor: F32) -> Traces:
  match ts:
    case Nil{}: []
    case Trace{f,a,v} <> tail: Trace{f,a,F32.mul(v,factor)} <> scaled(tail,factor)

def decay(ts: Traces,+factor: F32) -> Traces:
  Bool.pick(Traces,F32.is_eq(factor,0.0),[],scaled(ts,factor))

def carry(next: E.View<U32>,cut: Bool,t: Traces,factor: F32) -> Traces:
  match next cut:
    case E.Open{s,xs} False{}: decay(t,factor)
    case _ _: []

def learn(m: Model,event: E.Transition<U32>) -> Model:
  Agent{+w,tr,+cfg}=m
  Config{+linear,alpha,+gamma,l}=cfg
  E.Transition{+s,+a,r,+next,cut}=event
  delta=F32.sub(F32.add(r,F32.mul(gamma,future(next,linear,w))),value(linear,w,s,a))
  +e=grad(linear,tr,s,a)
  Agent{apply(e,w,F32.mul(alpha,delta)),carry(next,cut,e,F32.mul(gamma,l)),cfg}

def finish(m: Model,reason: E.Stop) -> Model:
  Agent{w,tr,c}=m
  Agent{w,[],c}

def traces(m: Model) -> Traces:
  Agent{w,tr,c}=m
  tr

def weights(m: Model) -> T.Table:
  Agent{w,t,c}=m
  w
