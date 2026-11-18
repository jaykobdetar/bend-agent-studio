import Base
import ./agents/td_lambda.bend as L
import ./engine.bend as E
import ./tabular.bend as T

law finish_reset:
  for m: L.Model
  for reason: E.Stop
  {L.traces(L.finish(m,reason)) == [] : L.Traces}

law no_carry_zero_factor:
  for ts: L.Traces
  for factor: F32
  for zero: {F32.is_eq(factor,0.0) == True{} : Bool}
  {L.decay(ts,factor) == [] : L.Traces}

# The weights after one transition from empty traces equal the ordinary
# semi-gradient one-step expected TD update, for either feature map.
law one_step_weights:
  for w: T.Table
  for lin: Bool
  for alpha: F32
  for gamma: F32
  for s: U32
  for a: U32
  for r: F32
  for next: E.View<U32>
  for cut: Bool
  {L.weights(L.learn(L.Agent{w,[],L.Config{lin,alpha,gamma,0.0}},E.Transition{s,a,r,next,cut})) ==
    L.apply(L.grad(lin,[],s,a),w,F32.mul(alpha,F32.sub(F32.add(r,F32.mul(gamma,L.future(next,lin,w))),L.value(lin,w,s,a)))) : T.Table}
