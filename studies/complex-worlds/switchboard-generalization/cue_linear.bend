import Base
import ../../../core/engine.bend as E
import ../../../core/parameters.bend as P
import ../../../agents/lib/linear.bend as L

# Width-16 Switchboard public encoding: memory * 50 + public view ID.
# One bias and every signed cue feature for each query. There is no rule
# connecting a query's ID to a particular cue and no access to hidden state.
type Model is Data:
  CueLinear{linear: L.Model, use_bits: Bool}

def signed_bit(mask: U32,i: U32) -> F32:
  Bool.pick(F32,U32.is_ne(U32.and(U32.shrn(mask,U32.to_nat(i)),1),0),1.0,F32.neg(1.0))

def cues(left: Nat,+base: U32,+mask: U32,+i: U32) -> L.Features:
  match left:
    case 0n: []
    case 1n+rest: L.Feature{U32.add(U32.add(base,1),i),signed_bit(mask,i)} <> cues(rest,base,mask,U32.add(i,1))

def feature_set(use_bits: Bool,+base: U32,mask: U32) -> L.Features:
  match use_bits:
    case True{}: L.Feature{base,1.0} <> cues(16n,base,mask,0)
    case False{}: [L.Feature{base,1.0}]

def query_features(nonquery: Bool,use_bits: Bool,view: U32,obs: U32) -> L.Features:
  match nonquery:
    case True{}: []
    case False{}: feature_set(use_bits,U32.mul(U32.sub(view,33),17),U32.div(obs,50))

def features(use_bits: Bool,+obs: U32) -> L.Features:
  +view=U32.mod(obs,50)
  query_features(U32.is_lt(view,33) || U32.is_lt(48,view),use_bits,view,obs)

def initial(seed: U32,params: P.Parameters) -> Model:
  +use_bits=F32.is_lt(0.5,P.get(params,"use_bits",1.0))
  # Both arms use effective step size .25 given 17 vs 1 active ±1 feature(s).
  alpha=Bool.pick(F32,use_bits,F32.div(0.25,17.0),0.25)
  CueLinear{L.initial(L.Settings{alpha,1.0,8192}),use_bits}

def bit_features(obs: U32) -> L.Features: features(True{},obs)
def only_bias(obs: U32) -> L.Features: features(False{},obs)

def act(model: Model,obs: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  match model:
    case CueLinear{linear,True{}}: L.act(~U32,~bit_features,linear,obs,legal,mode,word)
    case CueLinear{linear,False{}}: L.act(~U32,~only_bias,linear,obs,legal,mode,word)

def learn(model: Model,event: E.Transition<U32>) -> Model:
  match model:
    case CueLinear{linear,True{}}: CueLinear{L.learn(~U32,~bit_features,linear,event),True{}}
    case CueLinear{linear,False{}}: CueLinear{L.learn(~U32,~only_bias,linear,event),False{}}
