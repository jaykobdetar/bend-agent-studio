import Base
import ../../core/engine.bend as E
import ../../core/parameters.bend as P
import ../../core/tabular.bend as T
import ../reinforce/agent.bend as R

# One shared trainable tanh unit plus sparse per-action linear heads.
type Net is Data:
  Net{input: F32,bias: F32,heads: T.Table}

type Step is Data:
  Step{s: U32,legal: List<&2,U32>,a: U32,r: F32,old: F32,power: F32,value: F32}

type Sample is Data:
  Sample{s: U32,legal: List<&2,U32>,a: U32,old: F32,adv: F32,power: F32,g: F32}

type Config is Data:
  Config{alpha: F32,beta: F32,gamma: F32,clip: F32,episodes: U32,epochs: U32}

type Model is Data:
  Agent{net: Net,critic: T.Table,trajectory: List<&2,Step>,batch: List<&2,Sample>,count: U32,power: F32,cfg: Config}

def bounded(x: F32) -> F32: F32.max(F32.neg(8.0),F32.min(8.0,x))
def quota(x: F32) -> U32: F32.to_u32(F32.max(1.0,F32.min(32.0,x)))

def initial(seed: U32,+p: P.Parameters) -> Model:
  Agent{Net{1.0,0.0,[]},[],[],[],0,1.0,
    Config{R.clamp(P.get(p,"alpha",0.02)),R.clamp(P.get(p,"beta",0.1)),R.clamp(P.get(p,"gamma",1.0)),
    R.clamp(P.get(p,"clip",0.2)),quota(P.get(p,"batch",4.0)),quota(P.get(p,"epochs",2.0))}}

def feature(s: U32) -> F32: F32.sub(F32.div(U32.to_f32(U32.and(s,15)),8.0),1.0)

def hidden(w: F32,b: F32,s: U32) -> F32: F32.tanh(F32.add(F32.mul(w,feature(s)),b))

def logits(xs: List<&2,U32>,+heads: T.Table,+h: F32) -> T.Table:
  match xs:
    case Nil{}: []
    case +a <> rest:
      v=F32.add(T.lookup(heads,0,a),F32.mul(h,T.lookup(heads,1,a)))
      T.store(logits(rest,heads,h),0,a,T.Cell{0,v})

def policy(net: Net,s: U32,+xs: List<&2,U32>) -> R.Policy:
  Net{w,b,heads}=net
  R.probs(logits(xs,heads,hidden(w,b,s)),0,xs)

def act(m: Model,s: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  Agent{Net{w,b,heads},critic,t,batch,n,p,c}=m
  +xs=legal
  R.select(mode,logits(xs,heads,hidden(w,b,s)),0,xs,word)

def probability(xs: R.Policy,+a: U32) -> F32:
  match xs:
    case Nil{}: 0.0
    case R.Pick{k,p} <> rest: Bool.pick(F32,U32.is_eq(k,a),p,probability(rest,a))

def learn_context(m: Model,legal: List<&2,U32>,event: E.Transition<U32>) -> Model:
  Agent{+net,+critic,t,b,n,+pw,+c}=m
  Config{alpha,beta,gamma,clip,batch,epochs}=c
  E.Transition{+s,+a,r,next,cut}=event
  +xs=legal
  f: Step = Step{s,xs,a,r,probability(policy(net,s,xs),a),pw,T.lookup(critic,s,0)}
  Agent{net,critic,f <> t,b,n,F32.mul(pw,gamma),c}

# Gradient of min(ratio*A, clip(ratio)*A) w.r.t. current log probability.
# At a clipping boundary use the unclipped subgradient. Zero old probability
# is not a valid sample and contributes no policy update.
def multiplier(+old: F32,now: F32,+adv: F32,+clip: F32) -> F32:
  +ratio=F32.div(now,Bool.pick(F32,F32.is_gt(old,0.0),old,1.0))
  clipped=(F32.is_gt(adv,0.0) && F32.is_gt(ratio,F32.add(1.0,clip))) || (F32.is_lt(adv,0.0) && F32.is_lt(ratio,F32.sub(1.0,clip)))
  Bool.pick(F32,F32.is_le(old,0.0) || clipped,0.0,F32.mul(ratio,adv))

def score(+a: U32,chosen: U32,p: F32) -> F32:
  F32.sub(Bool.pick(F32,U32.is_eq(a,chosen),1.0,0.0),p)

def dh(xs: R.Policy,+heads: T.Table,+chosen: U32) -> F32:
  match xs:
    case Nil{}: 0.0
    case R.Pick{+a,p} <> rest: F32.add(F32.mul(score(a,chosen,p),T.lookup(heads,1,a)),dh(rest,heads,chosen))

def set_delta(+q: T.Table,+k: U32,+a: U32,d: F32) -> T.Table:
  T.store(q,k,a,T.Cell{0,bounded(F32.add(T.lookup(q,k,a),d))})

def heads_step(xs: R.Policy,q: T.Table,+h: F32,+a: U32,+rate: F32) -> T.Table:
  match xs:
    case Nil{}: q
    case R.Pick{+k,p} <> rest:
      +d=F32.mul(rate,score(k,a,p))
      heads_step(rest,set_delta(set_delta(q,0,k,d),1,k,F32.mul(h,d)),h,a,rate)

def step(net: Net,sample: Sample,alpha: F32,clip: F32) -> Net:
  Net{+w,+b,+heads}=net
  Sample{+s,+xs,+a,old,adv,pw,g}=sample
  +h=hidden(w,b,s)
  +ps=R.probs(logits(xs,heads,h),0,xs)
  +rate=F32.mul(F32.mul(alpha,pw),multiplier(old,probability(ps,a),adv,clip))
  +z=F32.mul(rate,F32.mul(F32.sub(1.0,F32.mul(h,h)),dh(ps,heads,a)))
  Net{bounded(F32.add(w,F32.mul(z,feature(s)))),bounded(F32.add(b,z)),heads_step(ps,heads,h,a,rate)}

def epoch(samples: List<&2,Sample>,net: Net,+alpha: F32,+clip: F32) -> Net:
  match samples:
    case Nil{}: net
    case x <> rest: epoch(rest,step(net,x,alpha,clip),alpha,clip)

def train(n: Nat,+samples: List<&2,Sample>,net: Net,+alpha: F32,+clip: F32) -> Net:
  match n:
    case 0n: net
    case 1n+rest: train(rest,samples,epoch(samples,net,alpha,clip),alpha,clip)

def advantages(t: List<&2,Step>,batch: List<&2,Sample>,+gamma: F32,after: F32) -> List<&2,Sample>:
  match t:
    case Nil{}: batch
    case Step{s,xs,a,r,old,pw,v} <> rest:
      +g=F32.add(r,F32.mul(gamma,after))
      advantages(rest,Sample{s,xs,a,old,F32.sub(g,v),pw,g} <> batch,gamma,g)

def fit_critic(samples: List<&2,Sample>,+critic: T.Table,+beta: F32) -> T.Table:
  match samples:
    case Nil{}: critic
    case Sample{+s,xs,a,old,adv,pw,g} <> rest:
      fit_critic(rest,R.add(critic,s,0,F32.mul(beta,F32.sub(g,T.lookup(critic,s,0)))),beta)

def batch_end(ready: Bool,net: Net,critic: T.Table,+data: List<&2,Sample>,n: U32,+cfg: Config) -> Model:
  match ready cfg:
    case False{} c: Agent{net,critic,[],data,n,1.0,c}
    case True{} Config{alpha,beta,gamma,clip,batch,epochs}:
      Agent{train(U32.to_nat(epochs),data,net,alpha,clip),fit_critic(data,critic,beta),[],[],0,1.0,cfg}

def finish(m: Model,reason: E.Stop) -> Model:
  Agent{net,critic,t,b,n,pw,+cfg}=m
  Config{alpha,beta,gamma,clip,quota_size,epochs}=cfg
  +num=U32.add(n,1)
  batch_end(U32.is_ge(num,quota_size),net,critic,advantages(t,b,gamma,0.0),num,cfg)
