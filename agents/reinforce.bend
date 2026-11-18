import Base
import ../engine.bend as E
import ../parameters.bend as P
import ../tabular.bend as T

type Pick is Data:
  Pick{a: U32,p: F32}

def Policy() -> Data: List<&2,Pick>

type Frame is Data:
  Frame{s: U32,a: U32,r: F32,discount: F32,policy: Policy,baseline: F32}

def History() -> Data: List<&2,Frame>

type Config is Data:
  Config{alpha: F32,beta: F32,gamma: F32}

type Model is Data:
  Agent{logits: T.Table,baseline: T.Table,history: History,power: F32,c: Config}

def clamp(x: F32) -> F32: F32.max(0.0,F32.min(1.0,x))

def initial(seed: U32,+p: P.Parameters) -> Model:
  Agent{[],[],[],1.0,Config{clamp(P.get(p,"alpha",0.05)),clamp(P.get(p,"beta",0.1)),clamp(P.get(p,"gamma",1.0))}}

def masses(xs: List<&2,U32>,+q: T.Table,+s: U32,+mx: F32) -> Policy:
  match xs:
    case Nil{}: []
    case +a <> tail: Pick{a,F32.exp(F32.sub(T.lookup(q,s,a),mx))} <> masses(tail,q,s,mx)

def total(xs: Policy) -> F32:
  match xs:
    case Nil{}: 0.0
    case Pick{a,p} <> rest: F32.add(p,total(rest))

def normalized(xs: Policy,+sum: F32) -> Policy:
  match xs:
    case Nil{}: []
    case Pick{a,p} <> rest: Pick{a,F32.div(p,sum)} <> normalized(rest,sum)

def probs(+q: T.Table,+s: U32,+xs: List<&2,U32>) -> Policy:
  mx=T.lookup(q,s,T.best_action(T.choices(xs,q,s)))
  +ps=masses(xs,q,s,mx)
  normalized(ps,total(ps))

def sample(xs: Policy,+draw: F32,fallback: U32) -> U32:
  match xs:
    case Nil{}: fallback
    case Pick{+a,+p} <> rest:
      Bool.pick(U32,F32.is_lt(draw,p),a,sample(rest,F32.sub(draw,p),a))

def select(mode: E.Mode,q: T.Table,s: U32,xs: List<&2,U32>,word: U32) -> U32:
  match mode:
    case E.Evaluate{}: T.best_action(T.choices(xs,q,s))
    case E.Train{}: sample(probs(q,s,xs),F32.div(U32.to_f32(U32.shrn(word,8n)),16777216.0),0)

def act(m: Model,s: U32,xs: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  Agent{q,b,h,p,c}=m
  select(mode,q,s,xs,word)


def learn_context(m: Model,legal: List<&2,U32>,event: E.Transition<U32>) -> Model:
  Agent{+q,+b,h,+power,Config{alpha,beta,+gamma}}=m
  E.Transition{+s,a,r,next,cut}=event
  f: Frame = Frame{s,a,r,power,probs(q,s,legal),T.lookup(b,s,0)}
  Agent{q,b,f <> h,F32.mul(power,gamma),Config{alpha,beta,gamma}}

def add(+q: T.Table,+s: U32,+a: U32,delta: F32) -> T.Table:
  T.store(q,s,a,T.Cell{U32.add(T.visits(q,s,a),1),F32.add(T.lookup(q,s,a),delta)})

def gradient(ps: Policy,+q: T.Table,+s: U32,+chosen: U32,+amount: F32) -> T.Table:
  match ps:
    case Nil{}: q
    case Pick{+a,p} <> rest:
      sign=F32.sub(Bool.pick(F32,U32.is_eq(a,chosen),1.0,0.0),p)
      gradient(rest,add(q,s,a,F32.mul(amount,sign)),s,chosen,amount)

def update(h: History,q: T.Table,b: T.Table,+cfg: Config,after: F32) -> Model:
  match h:
    case Nil{}: Agent{q,b,[],1.0,cfg}
    case Frame{+s,a,r,power,ps,v} <> rest:
      Config{alpha,beta,gamma}=cfg
      +g=F32.add(r,F32.mul(gamma,after))
      +adv=F32.sub(g,v)
      update(rest,gradient(ps,q,s,a,F32.mul(alpha,F32.mul(power,adv))),add(b,s,0,F32.mul(beta,adv)),cfg,g)

def finish(m: Model,reason: E.Stop) -> Model:
  Agent{q,b,h,power,c}=m
  update(h,q,b,c,0.0)

def history(m: Model) -> History:
  Agent{q,b,h,p,c}=m
  h
