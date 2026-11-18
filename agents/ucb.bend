import Base
import ./parameters.bend as P
import ./engine.bend as E
import ./tabular.bend as T

# The authorship interface consists of Model, initial, act and learn.
# In training, untried actions take priority. Then use the usual UCB1 bonus.
type Model is Data:
  UCB{values: T.Table, scale: F32}

def initial(seed: U32, params: P.Parameters) -> Model:
  UCB{[],F32.max(0.0,P.get(params,"scale",1.41421356))}

def total(table: T.Table, +obs: U32) -> U32:
  match table:
    case Nil{}: 0
    case T.Entry{s,a,n,v} <> rest: U32.add(Bool.pick(U32,U32.is_eq(s,obs),n,0),total(rest,obs))

def scores(actions: List<&2,U32>, +q: T.Table, +obs: U32, +scale: F32, +log_n: F32) -> T.Choices:
  match actions:
    case Nil{}: T.NoChoices{}
    case +a <> rest:
      n=T.visits(q,obs,a)
      bonus=F32.mul(scale,F32.sqrt(F32.div(log_n,U32.to_f32(U32.max(1,n)))))
      v=F32.add(T.lookup(q,obs,a),bonus)
      T.consider(a,v,scores(rest,q,obs,scale,log_n))

def untried(actions: List<&2,U32>, +q: T.Table, +obs: U32) -> Maybe<&2,U32>:
  match actions:
    case Nil{}: None{}
    case +a <> rest:
      Bool.pick(Maybe<&2,U32>,U32.is_eq(T.visits(q,obs,a),0),Some{a},untried(rest,q,obs))

def training(unseen: Maybe<&2,U32>, actions: List<&2,U32>, +q: T.Table, +obs: U32, c: F32) -> U32:
  match unseen:
    case Some{a}: a
    case None{}:
      log_n=F32.log(U32.to_f32(U32.max(1,total(q,obs))))
      T.best_action(scores(actions,q,obs,c,log_n))

def act(model: Model, obs: U32, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  match model mode:
    case UCB{q,c} E.Evaluate{}: T.best_action(T.choices(actions,q,obs))
    case UCB{+q,c} E.Train{}:
      +state=obs
      +legal=actions
      training(untried(legal,q,state),legal,q,state,c)

def learn(model: Model, event: E.Transition<U32>) -> Model:
  UCB{q,c}=model
  UCB{T.bandit(q,event),c}
