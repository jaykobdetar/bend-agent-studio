import Base
import ../../core/engine.bend as E
import ../../core/parameters.bend as P
import ../../worlds/acrobot.bend as A
import ../lib/linear.bend as L

# Two offset four-dimensional coarse tilings plus bias. All three are
# sparse unit features consumed by the existing general linear Q adapter.
def bin(+x: F32, +bound: F32, offset: F32) -> U32:
  scaled = F32.add(F32.mul(2.5,F32.add(1.0,F32.div(x,bound))),offset)
  U32.min(5,F32.to_u32(F32.max(0.0,F32.floor(scaled))))

def tile(state: A.Observation, +offset: F32) -> U32:
  A.Acrobot{a,b,v,w} = state
  x = bin(a,3.141592653589793,offset)
  y = bin(b,3.141592653589793,offset)
  z = bin(v,12.566370614359172,offset)
  k = bin(w,28.274333882308138,offset)
  U32.add(U32.mul(216,x),U32.add(U32.mul(36,y),U32.add(U32.mul(6,z),k)))

def features(+state: A.Observation) -> L.Features:
  [L.Feature{0,1.0},L.Feature{U32.add(1,tile(state,0.0)),1.0},L.Feature{U32.add(1297,tile(state,0.5)),1.0}]

def Model() -> Data: L.Model

def unit(x: F32) -> F32: F32.max(0.0,F32.min(1.0,x))

def initial(seed: U32,+params: P.Parameters) -> Model:
  L.initial(L.Settings{unit(P.get(params,"alpha",0.03)),unit(P.get(params,"gamma",0.99)),
    F32.to_u32(F32.mul(65536.0,unit(P.get(params,"epsilon",0.15))))})

def act(model: Model,obs: A.Observation,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  L.act(~A.Observation,~(obs => features(obs)),model,obs,legal,mode,word)

def learn(model: Model,event: E.Transition<A.Observation>) -> Model:
  L.learn(~A.Observation,~(obs => features(obs)),model,event)
