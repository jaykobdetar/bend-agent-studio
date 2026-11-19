import Base
import ../../core/arena.bend as A
import ../../core/arena_table.bend as Store
import ../../core/engine.bend as E
import ../../core/parameters.bend as P
import ../../core/tabular.bend as T

type Method is Data:
  Uniform{}
  Negamax{}
  Expected{}
  MonteCarlo{}

type Settings is Data:
  Settings{method: Method, alpha: F32, gamma: F32, buckets: U32}

type DecisionRecord is Data:
  PastMove{second: Bool, key: U32, action: U32, reward: F32}

type Model is Data:
  Player{config: Settings, table: Store.Tree, episode: List<&2,DecisionRecord>}

def method(value: U32) -> Method:
  match value:
    case 0: Uniform{}
    case 2: Expected{}
    case 3: MonteCarlo{}
    case _: Negamax{}

def unit(x: F32) -> F32: F32.max(0.0,F32.min(1.0,x))

def initial(seed: U32, params: P.Parameters) -> Model:
  +p=params
  rule=method(F32.to_u32(P.get(p,"rule",1.0)))
  epsilon=unit(P.get(p,"epsilon",0.25))
  buckets=F32.to_u32(F32.add(0.5,F32.mul(65536.0,epsilon)))
  Player{Settings{rule,unit(P.get(p,"alpha",0.25)),unit(P.get(p,"gamma",1.0)),buckets},Store.Empty{},[]}

def choose(explore: Bool, table: Store.Tree, key: U32, actions: List<&2,U32>, word: U32) -> U32:
  match explore:
    case True{}: T.random_action(actions,E.mix_word(U32.xor(word,2654435769)))
    case False{}: T.best_action(T.choices(actions,Store.get(key,table),0))

def explore(mode: E.Mode, buckets: U32, word: U32) -> Bool:
  match mode:
    case E.Evaluate{}: False{}
    case E.Train{}: U32.is_lt(U32.and(word,65535),buckets)

def act(model: Model, obs: A.Signal, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  match model obs:
    case Player{Settings{Uniform{},a,g,e},t,h} _: T.random_action(actions,word)
    case Player{Settings{rule,a,g,e},t,h} A.Mover{second,key}:
      +draw=word
      choose(explore(mode,e,draw),t,key,actions,draw)
    case _ _: 0

def estimate(method: Method, buckets: U32, options: T.Choices) -> F32:
  match method options:
    case _ T.NoChoices{}: 0.0
    case Expected{} T.Choices{a,q,sum,n}:
      +eps=F32.div(U32.to_f32(buckets),65536.0)
      F32.add(F32.mul(F32.sub(1.0,eps),q),F32.mul(eps,F32.div(sum,U32.to_f32(n))))
    case _ T.Choices{a,q,sum,n}: q

# The bootstrap is expressed in the first seat's units. Adjacent turns
# owned by the same seat retain their sign.
def first_value(method: Method, buckets: U32, table: Store.Tree, next: E.View<A.Signal>) -> F32:
  match next:
    case E.Open{A.Mover{side,key},legal}: A.perspective(side,estimate(method,buckets,T.choices(legal,Store.get(key,table),0)))
    case _: 0.0

def is_end(next: E.View<A.Signal>, truncated: Bool) -> Bool:
  match next:
    case E.End{s}: True{}
    case E.Open{s,legal}: truncated

def returns(history: List<&2,DecisionRecord>, table: Store.Tree, +gamma: F32, future: F32) -> Store.Tree:
  match history:
    case Nil{}: table
    case PastMove{second,key,a,reward} <> rest:
      +total=F32.add(reward,F32.mul(gamma,future))
      returns(rest,Store.update(table,key,a,T.SampleMean{},A.perspective(second,total)),gamma,total)

def monte_ending(done: Bool, cfg: Settings, +t: Store.Tree, history: List<&2,DecisionRecord>, gamma: F32, future: F32) -> Model:
  match done:
    case True{}: Player{cfg,returns(history,t,gamma,future),[]}
    case False{}: Player{cfg,t,history}

def learn(model: Model, event: E.Transition<A.Signal>) -> Model:
  match model event:
    case Player{Settings{Uniform{},a,g,e},t,h} _: Player{Settings{Uniform{},a,g,e},t,h}
    case Player{Settings{MonteCarlo{},alpha,+g,+e},+t,h} E.Transition{A.Mover{side,key},a,r,+next,cut}:
      future=first_value(Expected{},e,t,next)
      monte_ending(is_end(next,cut),Settings{MonteCarlo{},alpha,g,e},t,PastMove{side,key,a,r} <> h,g,future)
    case Player{Settings{+rule,+alpha,+g,+e},+t,h} E.Transition{A.Mover{side,key},a,r,next,cut}:
      total=F32.add(r,F32.mul(g,first_value(rule,e,t,next)))
      Player{Settings{rule,alpha,g,e},Store.update(t,key,a,T.Fixed{alpha},A.perspective(side,total)),h}
    case unchanged _: unchanged
