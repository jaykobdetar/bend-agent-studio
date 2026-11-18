import Base
import ./agents/td_lambda.bend as L
import ./tabular.bend as T
import ./engine.bend as E

def val(m: L.Model,s: U32,a: U32) -> F32:
  L.Agent{w,t,L.Config{linear,alpha,gamma,l}}=m
  L.value(linear,w,s,a)

def size(m: L.Model) -> U32: U32.from_nat(List.length(&2,L.Trace,L.traces(m)))

def fresh(linear: Bool,l: F32) -> L.Model: L.Agent{[],[],L.Config{linear,0.5,1.0,l}}

def first(m: L.Model) -> L.Model: L.learn(m,E.Transition{3,7,2.0,E.Open{4,[7]},False{}})

def last(m: L.Model) -> L.Model: L.learn(m,E.Transition{4,7,4.0,E.End{5},False{}})

def check(label: String,ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("pass - " ++ label)
    case False{}: IO.die(Unit,1,"failed - " ++ label)

def main() -> IO(Unit):
  +tab=last(first(fresh(False{},0.5)))
  +zero=last(first(fresh(False{},0.0)))
  +lin=last(first(fresh(True{},0.5)))
  +lin0=last(first(fresh(True{},0.0)))
  +p=first(fresh(False{},0.5))
  +cut=L.learn(p,E.Transition{4,7,1.0,E.Open{3,[7]},True{}})
  do IO<Unit>:
    check("tabular credit propagates to prior state",F32.is_eq(val(tab,3,7),2.0) && F32.is_eq(val(tab,4,7),2.0))
    check("lambda zero is ordinary tabular TD",F32.is_eq(val(zero,3,7),1.0) && F32.is_eq(val(zero,4,7),2.0))
    check("linear accumulating shared bias and local features",F32.is_eq(val(lin,3,7),5.0) && F32.is_eq(val(lin,4,7),4.75))
    check("zero-lambda linear semi-gradient",F32.is_eq(val(lin0,3,7),3.5) && F32.is_eq(val(lin0,4,7),4.0))
    check("truncation bootstraps then clears",F32.is_eq(val(cut,4,7),1.0) && U32.is_eq(size(cut),0))
    check("no cross-episode traces",U32.is_eq(size(tab),0) && U32.is_eq(size(L.finish(p,E.Illegal{9})),0))
