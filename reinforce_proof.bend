import Base
import ./agents/reinforce.bend as R
import ./core/tabular.bend as T
import ./reinforce_laws.bend as Law

def emptied(h: R.History,q: T.Table,b: T.Table,c: R.Config,g: F32) ->
    {R.history(R.update(h,q,b,c,g)) == [] : R.History}:
  match h c:
    case Nil{} cfg: {==}
    case R.Frame{+s,a,r,p,ps,v} <> rest R.Config{+alpha,+beta,+gamma}:
      +ret=F32.add(r,F32.mul(gamma,g))
      +adv=F32.sub(ret,v)
      emptied(rest,R.gradient(ps,q,s,a,F32.mul(alpha,F32.mul(p,adv))),R.add(b,s,0,F32.mul(beta,adv)),R.Config{alpha,beta,gamma},ret)

def Law.episode_buffer_empty(m,reason):
  match m:
    case R.Agent{q,b,h,p,c}: emptied(h,q,b,c,0.0)
