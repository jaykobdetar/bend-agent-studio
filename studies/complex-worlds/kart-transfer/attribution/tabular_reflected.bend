import Base
import ../../../../core/engine.bend as E
import ../../../../core/parameters.bend as P
import ../../../../core/tabular.bend as T
import ../kart_features.bend as F

# The entry backend itself is generated as study.bend, so an authored agent
# cannot import that entry point. Use the very same stock sparse table,
# greedy bootstrap and fixed-rate arithmetic as Study.Q Learning instead.
type Model is Data:
  Table{values: T.Table, reflect: Bool}

def initial(seed: U32,params: P.Parameters) -> Model:
  Table{[],F32.is_lt(0.5,P.get(params,"reflect",1.0))}

def encode(s: F.Sense) -> U32:
  F.Sense{left,lane,speed,look}=s
  pose=U32.add(U32.mul(9,U32.sub(left,1)),U32.add(U32.mul(3,lane),U32.sub(speed,1)))
  U32.add(1,U32.add(U32.mul(125,pose),look))

def obs(flip: Bool,+obs: U32) -> U32:
  match flip obs:
    case True{} +n: encode(F.canonical(True{},F.decode(U32.sub(n,1))))
    case False{} n: n

def switch(reflect: Bool,+raw: U32) -> U32:
  obs(reflect && F.flip_at(raw),raw)

def explores(mode: E.Mode,word: U32) -> Bool:
  match mode:
    case E.Train{}: U32.is_lt(U32.and(word,65535),16384)
    case E.Evaluate{}: False{}

def select(explore: Bool,values: T.Table,obs: U32,legal: List<&2,U32>,word: U32) -> U32:
  match explore:
    case True{}: T.random_action(legal,E.mix_word(U32.xor(word,2654435769)))
    case False{}: T.sampled_table(values,obs,legal,word)

def train(values: T.Table,obs0: U32,legal: List<&2,U32>,+word: U32) -> U32:
  select(explores(E.Train{},word),values,obs0,legal,word)

def policy(mode: E.Mode,values: T.Table,obs0: U32,legal: List<&2,U32>,word: U32) -> U32:
  match mode:
    case E.Evaluate{}: T.best_action(T.choices(legal,values,obs0))
    case E.Train{}: train(values,obs0,legal,word)

def choose(model: Model,+obs0: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  Table{values,reflect}=model
  +flip=reflect && F.flip_at(obs0)
  F.steering(flip,policy(mode,values,obs(flip,obs0),legal,word))

def act(model: Model,obs0: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  choose(model,obs0,legal,mode,word)

def next_view(reflect: Bool,next_view: E.View<U32>) -> E.View<U32>:
  match next_view:
    case E.End{o}: E.End{switch(reflect,o)}
    case E.Open{o,legal}: E.Open{switch(reflect,o),legal}

def learn(model: Model,event: E.Transition<U32>) -> Model:
  Table{+values,+reflect}=model
  E.Transition{+obs0,a,r,next,truncated}=event
  +flip=reflect && F.flip_at(obs0)
  target=F32.add(r,F32.mul(1.0,T.bootstrap(T.Greedy{},values,next_view(reflect,next))))
  Table{T.adjust(values,obs(flip,obs0),F.steering(flip,a),T.Fixed{0.25},target),reflect}
