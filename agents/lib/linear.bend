import Base
import ../../core/engine.bend as E
import ../../core/weights.bend as W
import ../../core/tabular.bend as T

# Sparse real-valued features; IDs are full unsigned 32-bit words.
type Feature is Data:
  Feature{id: U32,value: F32}

def Features() -> Data: List<&2,Feature>

type Settings is Data:
  Settings{alpha: F32,gamma: F32,exploration: U32}

type Model is Data:
  Linear{settings: Settings,weights: W.Tree}

def initial(settings: Settings) -> Model: Linear{settings,W.Vacant{}}

def append(path: W.Path,tail: W.Path) -> W.Path:
  match path:
    case W.Here{}: tail
    case W.Low{p}: W.Low{append(p,tail)}
    case W.High{p}: W.High{append(p,tail)}

# 64 decisions preserve the complete (action,feature) pair. W.Row.left
# holds the scalar; right/coast are unused. No restriction to actions 0..2.
def address(action: U32,feature: U32) -> W.Path:
  append(W.address(32n,action),W.address(32n,feature))

def weight(tree: W.Tree,action: U32,feature: U32) -> F32:
  W.action_value(W.read(address(action,feature),tree),0)

def put(tree: W.Tree,action: U32,feature: U32,value: F32) -> W.Tree:
  W.put(address(action,feature),tree,W.Weights{value,0.0,0.0})

# Right-associated dot product in authored list order, with F32 arithmetic.
# Repeated IDs contribute repeated terms; they are not silently deduplicated.
def dot(features: Features,+tree: W.Tree,+action: U32) -> F32:
  match features:
    case Nil{}: 0.0
    case Feature{id,value} <> rest:
      F32.add(F32.mul(value,weight(tree,action,id)),dot(rest,tree,action))

def choices(legal: List<&2,U32>,+features: Features,+tree: W.Tree) -> T.Choices:
  match legal:
    case Nil{}: T.NoChoices{}
    case +a <> rest: T.consider(a,dot(features,tree,a),choices(rest,features,tree))

def select(explore: Bool,features: Features,tree: W.Tree,legal: List<&2,U32>,word: U32) -> U32:
  match explore:
    case True{}: T.random_action(legal,word)
    case False{}: T.best_action(choices(legal,features,tree))

def training(mode: E.Mode) -> Bool:
  match mode:
    case E.Train{}: True{}
    case E.Evaluate{}: False{}

def act(~O: Data,~features: O -> Features,model: Model,obs: O,legal: List<&2,U32>,mode: E.Mode,+word: U32) -> U32:
  Linear{Settings{alpha,gamma,epsilon},tree}=model
  select(training(mode) && U32.is_lt(U32.and(word,65535),epsilon),features(obs),tree,legal,E.mix_word(U32.xor(word,2654435769)))

def future(~O: Data,~features: O -> Features,tree: W.Tree,view: E.View<O>) -> F32:
  match view:
    case E.End{obs}: 0.0
    case E.Open{obs,legal}: T.option_value(T.Greedy{},choices(legal,features(obs),tree))

# The TD error is frozen before touching any weights. Apply each sparse
# gradient term left-to-right. Duplicate IDs accumulate sequentially in F32.
def apply(features: Features,+tree: W.Tree,+action: U32,+rate: F32) -> W.Tree:
  match features:
    case Nil{}: tree
    case Feature{+id,value} <> rest:
      updated=F32.add(weight(tree,action,id),F32.mul(rate,value))
      apply(rest,put(tree,action,id,updated),action,rate)

def learn(~O: Data,~features: O -> Features,model: Model,event: E.Transition<O>) -> Model:
  Linear{+settings,+tree}=model
  Settings{alpha,gamma,epsilon}=settings
  E.Transition{obs,+action,reward,next,truncated}=event
  +active=features(obs)
  delta=F32.sub(F32.add(reward,F32.mul(gamma,future(~O,~features,tree,next))),dot(active,tree,action))
  Linear{settings,apply(active,tree,action,F32.mul(alpha,delta))}

def weights(model: Model) -> W.Tree:
  Linear{settings,tree}=model
  tree
