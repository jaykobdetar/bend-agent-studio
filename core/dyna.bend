import Base
import ./engine.bend as E
import ./tabular.bend as T

# The empirical model groups transitions by public next view, retaining
# their counts and mean rewards. Every backup uses observed transitions.
type Sample is Data:
  Sample{next: E.View<U32>, count: U32, reward: F32}

type PairModel is Data:
  PairModel{obs: U32, action: U32, total: U32, outcomes: List<&2, Sample>}

def Model() -> Data: List<&2, PairModel>

type State is Data:
  Planner{values: T.Table, experience: Model, pairs: U32, seed: U32}

def same_actions(a: List<&2,U32>, b: List<&2,U32>) -> Bool:
  match a b:
    case Nil{} Nil{}: True{}
    case x <> xs y <> ys: U32.is_eq(x,y) && same_actions(xs,ys)
    case _ _: False{}

def same_view(a: E.View<U32>, b: E.View<U32>) -> Bool:
  match a b:
    case E.End{x} E.End{y}: U32.is_eq(x,y)
    case E.Open{x,xs} E.Open{y,ys}: U32.is_eq(x,y) && same_actions(xs,ys)
    case _ _: False{}

def choose(~A: Data, hit: Bool, yes: Unit -> A, no: Unit -> A) -> A:
  match hit:
    case True{}: yes(Unit{})
    case False{}: no(Unit{})

def sample(outcomes: List<&2, Sample>, +next: E.View<U32>, +r: F32) -> List<&2, Sample>:
  match outcomes:
    case Nil{}: [Sample{next,1,r}]
    case Sample{+view,+n,+mean} <> +rest:
      +count = U32.add(n,1)
      choose(~List<&2,Sample>, same_view(view,next),
        u => Sample{view,count,F32.add(mean,F32.div(F32.sub(r,mean),U32.to_f32(count)))} <> rest,
        u => Sample{view,n,mean} <> sample(rest,next,r))

type LearnedModel is Data:
  LearnedModel{experience: Model, pairs: U32}

def prepend(entry: PairModel, m: LearnedModel) -> LearnedModel:
  LearnedModel{rest, n} = m
  LearnedModel{entry <> rest,n}

def observe(experience: Model, +pairs: U32, +obs: U32, +action: U32, +r: F32, +next: E.View<U32>) -> LearnedModel:
  match experience:
    case Nil{}: LearnedModel{[PairModel{obs,action,1,[Sample{next,1,r}]}], U32.add(pairs,1)}
    case PairModel{+s,+a,+n,+outcomes} <> +rest:
      choose(~LearnedModel,U32.is_eq(s,obs) && U32.is_eq(a,action),
        u => LearnedModel{PairModel{s,a,U32.add(n,1),sample(outcomes,next,r)} <> rest,pairs},
        u => prepend(PairModel{s,a,n,outcomes},observe(rest,pairs,obs,action,r,next)))

def target(+values: T.Table, +gamma: F32, outcomes: List<&2, Sample>) -> F32:
  match outcomes:
    case Nil{}: 0.0
    case Sample{next,n,reward} <> rest:
      v = F32.add(reward,F32.mul(gamma,T.bootstrap(T.Greedy{},values,next)))
      F32.add(F32.mul(U32.to_f32(n),v),target(values,gamma,rest))

def backup(+values: T.Table, alpha: F32, gamma: F32, maybe: Maybe<&2,PairModel>) -> T.Table:
  match maybe:
    case None{}: values
    case Some{PairModel{s,a,n,outcomes}}:
      q = F32.div(target(values,gamma,outcomes),U32.to_f32(n))
      T.adjust(values,s,a,T.Fixed{alpha},q)

def plan(budget: Nat, values: T.Table, +experience: Model, +pairs: U32, +seed: U32,
         +alpha: F32, +gamma: F32) -> State:
  match budget:
    case 0n: Planner{values,experience,pairs,seed}
    case 1n+rest:
      index = U32.to_nat(U32.mod(E.mix_word(seed),U32.max(1,pairs)))
      updated = backup(values,alpha,gamma,List.get(&2,PairModel,experience,index))
      plan(rest,updated,experience,pairs,E.next_seed(seed),alpha,gamma)

def with_model(budget: Nat, values: T.Table, seed: U32, alpha: F32, gamma: F32, learned: LearnedModel) -> State:
  LearnedModel{experience,pairs} = learned
  plan(budget,values,experience,pairs,seed,alpha,gamma)

def learn(budget: Nat, state: State, +alpha: F32, +gamma: F32, event: E.Transition<U32>) -> State:
  match state event:
    case Planner{+values,experience,pairs,seed} E.Transition{+s,+a,+r,+next,truncated}:
      target = F32.add(r,F32.mul(gamma,T.bootstrap(T.Greedy{},values,next)))
      updated = T.adjust(values,s,a,T.Fixed{alpha},target)
      with_model(budget,updated,seed,alpha,gamma,observe(experience,pairs,s,a,r,next))

def values(state: State) -> T.Table:
  Planner{q,experience,pairs,seed} = state
  q

def experience(state: State) -> Model:
  Planner{q,m,pairs,seed} = state
  m
