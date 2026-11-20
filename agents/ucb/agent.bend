import Base
import ../../core/parameters.bend as P
import ../../core/engine.bend as E
import ../../core/tabular.bend as T

# The authorship interface consists of Model, initial, act and learn.
# In training, untried actions take priority. Then use the usual UCB1 bonus.
type Model is Data:
  UCB{values: T.Table, scale: F32}

def initial(seed: U32, params: P.Parameters) -> Model:
  UCB{[],F32.max(0.0,P.get(params,"scale",1.41421356))}

def total(table: T.Table, +obs: U32) -> U32:
  match table:
    case Nil{}: 0
    case T.Indexed{tree} <> rest: T.tree_total(tree,obs)
    case T.Entry{s,a,n,v} <> rest: U32.add(Bool.pick(U32,U32.is_eq(s,obs),n,0),total(rest,obs))

type ScoreInput is Data:
  ScoreInput{values: T.Table, obs: U32, scale: F32, log_total: F32}

def score(input: ScoreInput,+action: U32) -> F32:
  ScoreInput{+q,+obs,scale,log_n}=input
  n=T.visits(q,obs,action)
  bonus=F32.mul(scale,F32.sqrt(F32.div(log_n,U32.to_f32(U32.max(1,n)))))
  F32.add(T.lookup(q,obs,action),bonus)

def untried(actions: List<&2,U32>, +q: T.Table, +obs: U32) -> Maybe<&2,U32>:
  match actions:
    case Nil{}: None{}
    case +a <> rest:
      Bool.pick(Maybe<&2,U32>,U32.is_eq(T.visits(q,obs,a),0),Some{a},untried(rest,q,obs))

def training(unseen: Maybe<&2,U32>, actions: List<&2,U32>, +q: T.Table, +obs: U32, c: F32,word: U32) -> U32:
  match unseen:
    case Some{a}: a
    case None{}:
      log_n=F32.log(U32.to_f32(U32.max(1,total(q,obs))))
      T.sampled_best(~ScoreInput,~(x => a => score(x,a)),actions,ScoreInput{q,obs,c,log_n},word)

def act(model: Model, obs: U32, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  match model mode:
    case UCB{q,c} E.Evaluate{}: T.best_action(T.choices(actions,q,obs))
    case UCB{+q,c} E.Train{}:
      +state=obs
      +legal=actions
      training(untried(legal,q,state),legal,q,state,c,word)

def learn(model: Model, event: E.Transition<U32>) -> Model:
  UCB{q,c}=model
  UCB{T.bandit(q,event),c}
