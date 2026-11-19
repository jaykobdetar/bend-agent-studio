import Base
import ./engine.bend as E
import ./tabular.bend as T
import ./dyna.bend as D

# The fitting API takes a fixed batch of public transitions; its types
# contain no environment, rollout, or simulator callbacks.
type Method is Data:
  Clone{}
  Fitted{}
  Supported{}

type Policy is Data:
  Policy{method: Method, values: T.Table, counts: T.Table}

def empty() -> D.LearnedModel: D.LearnedModel{[],0}

def observe(batch: D.LearnedModel, event: E.Transition<U32>) -> D.LearnedModel:
  D.LearnedModel{model,pairs}=batch
  E.Transition{s,a,r,next,truncated}=event
  D.observe(model,pairs,s,a,r,next)

def frequencies(batch: D.Model) -> T.Table:
  match batch:
    case Nil{}: []
    case D.PairModel{s,a,+n,outcomes} <> rest:
      T.store(frequencies(rest),s,a,T.Cell{n,U32.to_f32(n)})

def consider(method: Method, +a: U32, n: U32, q: T.Table, s: U32, options: T.Choices) -> T.Choices:
  match method n:
    case Clone{} count: T.consider(a,U32.to_f32(count),options)
    case Supported{} 0: options
    case _ _: T.consider(a,T.lookup(q,s,a),options)

def choices(legal: List<&2,U32>, +method: Method, +q: T.Table, +counts: T.Table, +s: U32) -> T.Choices:
  match legal:
    case Nil{}: T.NoChoices{}
    case +a <> rest:
      n=T.visits(counts,s,a)
      consider(method,a,n,q,s,choices(rest,method,q,counts,s))

def first(legal: List<&2,U32>) -> U32:
  match legal:
    case Nil{}: 0
    case a <> rest: a

def fallback(options: T.Choices, legal: List<&2,U32>) -> U32:
  match options:
    case T.NoChoices{}: first(legal)
    case T.Choices{a,q,sum,n}: a

def act(policy: Policy, s: U32, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  Policy{method,q,counts}=policy
  +legal=actions
  fallback(choices(legal,method,q,counts,s),legal)

def future(method: Method, q: T.Table, counts: T.Table, view: E.View<U32>) -> F32:
  match view:
    case E.End{s}: 0.0
    case E.Open{s,legal}: T.option_value(T.Greedy{},choices(legal,method,q,counts,s))

def targets(outcomes: List<&2,D.Sample>, +method: Method, +q: T.Table, +counts: T.Table, +gamma: F32) -> F32:
  match outcomes:
    case Nil{}: 0.0
    case D.Sample{next,n,reward} <> rest:
      value=F32.add(reward,F32.mul(gamma,future(method,q,counts,next)))
      F32.add(F32.mul(U32.to_f32(n),value),targets(rest,method,q,counts,gamma))

# Each fitted-Q iteration reads the previous table for every target.
def sweep(batch: D.Model, +method: Method, +q: T.Table, +counts: T.Table, +gamma: F32) -> T.Table:
  match batch:
    case Nil{}: []
    case D.PairModel{s,a,+n,outcomes} <> rest:
      estimate=F32.div(targets(outcomes,method,q,counts,gamma),U32.to_f32(n))
      T.store(sweep(rest,method,q,counts,gamma),s,a,T.Cell{n,estimate})

def iterate(n: Nat, +batch: D.Model, +method: Method, q: T.Table, +counts: T.Table, +gamma: F32) -> T.Table:
  match n:
    case 0n: q
    case 1n+rest: iterate(rest,batch,method,sweep(batch,method,q,counts,gamma),counts,gamma)

def fitted(method: Method, experience: D.Model, +counts: T.Table, iterations: Nat, gamma: F32) -> Policy:
  match method:
    case Clone{}: Policy{Clone{},[],counts}
    case +other: Policy{other,iterate(iterations,experience,other,[],counts,gamma),counts}

def fit(method: Method, batch: D.LearnedModel, iterations: Nat, gamma: F32) -> Policy:
  D.LearnedModel{+experience,pairs}=batch
  fitted(method,experience,frequencies(experience),iterations,gamma)
