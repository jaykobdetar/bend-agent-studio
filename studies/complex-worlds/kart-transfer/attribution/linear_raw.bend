import Base
import ../../../../core/engine.bend as E
import ../../../../core/parameters.bend as P
import ../../../../agents/lib/linear.bend as L
import ../kart_features.bend as F

def Model() -> Data: L.Model

def initial(seed: U32,params: P.Parameters) -> Model:
  F.initial(seed,params)

def features(obs: U32) -> L.Features:
  match obs:
    case 0: []
    case n: F.basis(F.decode(U32.sub(n,1)))

def act(model: Model,obs: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  L.act(~U32,~features,model,obs,legal,mode,word)

def learn(model: Model,event: E.Transition<U32>) -> Model:
  L.learn(~U32,~features,model,event)
