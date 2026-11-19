import Base
import ./agents/clipped_pg.bend as P
import ./core/engine.bend as E
import ./core/tabular.bend as T

def count(m: P.Model) -> U32:
  P.Agent{net,critic,t,b,n,pw,c}=m
  n

def size(m: P.Model) -> U32:
  P.Agent{net,critic,t,b,n,pw,c}=m
  U32.from_nat(List.length(&2,P.Sample,b))

def head(m: P.Model,k: U32,a: U32) -> F32:
  P.Agent{P.Net{w,b,h},critic,t,data,n,pw,c}=m
  T.lookup(h,k,a)

def hidden_ok(net: P.Net) -> Bool:
  P.Net{w,b,h}=net
  F32.is_eq(w,F32.neg(0.25)) && F32.is_eq(b,0.25)

def episode(m: P.Model) -> P.Model:
  P.finish(P.learn_context(m,[8,9],E.Transition{8,9,2.0,E.End{7},False{}}),E.Terminal{})

def check(label: String,ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("pass - " ++ label)
    case False{}: IO.die(Unit,1,"failed - " ++ label)

def main() -> IO(Unit):
  +m: P.Model = P.Agent{P.Net{1.0,0.0,[]},[],[],[],0,1.0,P.Config{0.25,0.5,1.0,0.2,2,1}}
  +one=episode(m)
  +two=episode(one)
  +single: P.Sample = P.Sample{8,[8,9],9,0.5,2.0,1.0,2.0}
  +after=P.step(P.Net{1.0,0.0,[]},single,0.25,0.2)
  +netmodel: P.Model = P.Agent{after,[],[],[],0,1.0,P.Config{0.25,0.5,1.0,0.2,2,1}}
  +heads=T.store([],1,9,T.Cell{0,1.0})
  +hstep=P.step(P.Net{0.0,0.0,heads},P.Sample{0,[8,9],9,0.5,2.0,1.0,2.0},0.25,0.2)
  do IO<Unit>:
    check("chain rule through trainable tanh weight and bias",hidden_ok(hstep))
    check("high positive and low negative ratios clip gradients",F32.is_eq(P.multiplier(0.5,0.75,2.0,0.25),0.0) && F32.is_eq(P.multiplier(0.5,0.25,F32.neg(2.0),0.25),0.0))
    check("opposite sides retain signed ratio gradient",F32.is_eq(P.multiplier(0.5,0.25,2.0,0.25),1.0) && F32.is_eq(P.multiplier(0.5,0.75,F32.neg(2.0),0.25),F32.neg(3.0)))
    check("zero old probability safely ignored",F32.is_eq(P.multiplier(0.0,1.0,2.0,0.2),0.0))
    check("hand-computed two-action network head gradient",F32.is_eq(head(netmodel,0,9),0.25) && F32.is_eq(head(netmodel,0,8),F32.neg(0.25)))
    check("policy frozen until batch boundary",U32.is_eq(count(one),1) && U32.is_eq(size(one),1) && F32.is_eq(head(one,0,9),0.0))
    check("next episode triggers update then clears batch",U32.is_eq(count(two),0) && U32.is_eq(size(two),0) && F32.is_gt(head(two,0,9),0.0))
