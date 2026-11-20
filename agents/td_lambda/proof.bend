import Base
import ./laws.bend as Law
import ./agent.bend as L

def Law.finish_reset(m,reason):
  match m:
    case L.Agent{w,t,c}: {==}
def Law.no_carry_zero_factor(ts,factor,zero):
  %Equal.sym(Bool,F32.is_eq(factor,0.0),True{},zero) :
    {Bool.pick(L.Traces,_,[],L.scaled(ts,factor)) == [] : L.Traces}
  {==}
def Law.one_step_weights(w,lin,alpha,gamma,s,a,r,next,cut): {==}

def Law.evaluation_is_first_max(weights,traces,linear,alpha,gamma,rate,s,legal,word): {==}
