import Base
import ./agents/reinforce.bend as R
import ./core/engine.bend as E
import ./core/tabular.bend as T

def pref(m: R.Model,s: U32,a: U32) -> F32:
  R.Agent{q,b,h,p,c}=m
  T.lookup(q,s,a)

def baseline(m: R.Model,s: U32) -> F32:
  R.Agent{q,b,h,p,c}=m
  T.lookup(b,s,0)

def size(m: R.Model) -> U32: U32.from_nat(List.length(&2,R.Frame,R.history(m)))

def check(label: String,ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("pass - " ++ label)
    case False{}: IO.die(Unit,1,"failed - " ++ label)

def main() -> IO(Unit):
  +m: R.Model = R.Agent{[],[],[],1.0,R.Config{1.0,0.5,0.5}}
  +one=R.learn_context(m,[3,7],E.Transition{10,7,1.0,E.Open{20,[9]},False{}})
  +two=R.learn_context(one,[9],E.Transition{20,9,4.0,E.End{30},False{}})
  +out=R.finish(two,E.Terminal{})
  +bad=R.finish(one,E.Illegal{99})
  do IO<Unit>:
    check("no updates before finish",F32.is_eq(pref(two,10,7),0.0) && U32.is_eq(size(two),2))
    check("discounted return 3 times exact binary score gradient",F32.is_eq(pref(out,10,7),1.5) && F32.is_eq(pref(out,10,3),F32.neg(1.5)))
    check("singleton legal set has no policy gradient",F32.is_eq(pref(out,20,9),0.0))
    check("baseline learns MC targets",F32.is_eq(baseline(out,10),1.5) && F32.is_eq(baseline(out,20),2.0))
    check("illegal finish trains only prior accepted step",F32.is_eq(pref(bad,10,7),0.5) && U32.is_eq(size(bad),0))
    check("greedy evaluation and softmax word boundaries",U32.is_eq(R.act(out,10,[3,7],E.Evaluate{},0),7) && U32.is_eq(R.act(m,10,[3,7],E.Train{},2147483648),7))
