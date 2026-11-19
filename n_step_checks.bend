import Base
import ./agents/n_step.bend as N
import ./core/engine.bend as E
import ./core/tabular.bend as T

def value(m: N.Model,s: U32,a: U32) -> F32:
  N.Agent{q,b,c}=m
  T.lookup(q,s,a)

def size(m: N.Model) -> U32: U32.from_nat(List.length(&2,N.Item,N.buffer(m)))

def check(label: String,ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("pass - " ++ label)
    case False{}: IO.die(Unit,1,"failed - " ++ label)

def main() -> IO(Unit):
  +q=T.store([],2,7,T.Cell{1,8.0})
  +m: N.Model = N.Agent{q,[],N.Config{2,1.0,0.5}}
  +one=N.learn(m,E.Transition{0,5,1.0,E.Open{1,[6]},False{}})
  +two=N.learn(one,E.Transition{1,6,2.0,E.Open{2,[7]},False{}})
  +end=N.learn(two,E.Transition{2,7,4.0,E.End{3},False{}})
  +cut=N.learn(one,E.Transition{1,6,2.0,E.Open{2,[7]},True{}})
  +bad=N.finish(one,E.Illegal{42})
  do IO<Unit>:
    check("first transition remains pending",U32.is_eq(size(one),1) && F32.is_eq(value(one,0,5),0.0))
    check("n=2 target uses both rewards and gamma squared continuation",F32.is_eq(value(two,0,5),4.0) && U32.is_eq(size(two),1))
    check("terminal flushes suffixes without bootstrap",F32.is_eq(value(end,1,6),4.0) && F32.is_eq(value(end,2,7),4.0) && U32.is_eq(size(end),0))
    check("cut flushes all suffixes against the same boundary value",F32.is_eq(value(cut,0,5),4.0) && F32.is_eq(value(cut,1,6),6.0) && U32.is_eq(size(cut),0))
    check("illegal flushes a short prefix without a fake reward",F32.is_eq(value(bad,0,5),1.0) && U32.is_eq(size(bad),0))
