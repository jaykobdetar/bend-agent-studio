import Base
import ../../core/engine.bend as E
import ../../core/parameters.bend as P
import ../lib/linear.bend as L

# Example feature map: shared bias plus an explicitly hashed state indicator.
# Replace this function to author arbitrary sparse, signed or continuous inputs.
def features(obs: U32) -> L.Features:
  [L.Feature{0,1.0},L.Feature{U32.add(1,U32.and(obs,65535)),1.0}]

def Model() -> Data: L.Model

def unit(x: F32) -> F32: F32.max(0.0,F32.min(1.0,x))

def initial(seed: U32,+params: P.Parameters) -> Model:
  L.initial(L.Settings{unit(P.get(params,"alpha",0.05)),unit(P.get(params,"gamma",0.95)),
    F32.to_u32(F32.mul(65536.0,unit(P.get(params,"epsilon",0.125))))})

def act(model: Model,obs: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  L.act(~U32,~features,model,obs,legal,mode,word)

def learn(model: Model,event: E.Transition<U32>) -> Model:
  L.learn(~U32,~features,model,event)
