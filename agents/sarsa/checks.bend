import Base
import ./agent.bend as S
import ../../core/tabular.bend as T
import ../../core/engine.bend as E

def val(m: S.Model,s: U32,a: U32) -> F32:
  S.Agent{q,p,alpha,gamma}=m
  T.lookup(q,s,a)

def is_clear(p: S.Pending) -> Bool:
  match p:
    case S.Clear{}: True{}
    case _: False{}

def clear(m: S.Model) -> Bool: is_clear(S.pending(m))

def check(label: String,ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("pass - " ++ label)
    case False{}: IO.die(Unit,1,"failed - " ++ label)

def main() -> IO(Unit):
  +q=T.store(T.store([],1,7,T.Cell{1,8.0}),1,9,T.Cell{1,4.0})
  +m: S.Model = S.Agent{q,S.Clear{},1.0,0.5}
  +wait=S.learn(m,E.Transition{0,3,2.0,E.Open{1,[7,9]},False{}})
  +end=S.learn(wait,E.Transition{1,9,6.0,E.End{2},False{}})
  +trunc=S.learn(m,E.Transition{0,3,2.0,E.Open{1,[7,9]},True{}})
  +illegal=S.finish(wait,E.Illegal{99})
  do IO<Unit>:
    check("pause keeps first transition pending",F32.is_eq(val(wait,0,3),0.0) && Bool.not(clear(wait)))
    check("sampled non-greedy next action, not maximum",F32.is_eq(val(end,0,3),4.0))
    check("terminal target is reward and clears buffer",F32.is_eq(val(end,1,9),6.0) && clear(end))
    check("truncated expected bootstrap = 2 + 0.5*(0.875*8+0.125*4)",F32.is_eq(val(trunc,0,3),5.75) && clear(trunc))
    check("illegal end credits last real reward only",F32.is_eq(val(illegal,0,3),2.0) && clear(illegal))
    check("terminal finish does not update again",F32.is_eq(val(S.finish(end,E.Terminal{}),1,9),6.0))
