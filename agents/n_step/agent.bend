import Base
import ../../core/engine.bend as E
import ../../core/parameters.bend as P
import ../../core/tabular.bend as T
import ../lib/td_values.bend as V

type Item is Data:
  Item{s: U32,a: U32,r: F32}

def Buffer() -> Data: List<&2,Item>

type Config is Data:
  Config{n: U32,alpha: F32,gamma: F32}

type Model is Data:
  Agent{q: T.Table,buffer: Buffer,cfg: Config}

def initial(seed: U32,+p: P.Parameters) -> Model:
  n=F32.to_u32(F32.max(1.0,F32.min(32.0,P.get(p,"n",3.0))))
  Agent{[],[],Config{n,V.unit(P.get(p,"alpha",0.25)),V.unit(P.get(p,"gamma",0.9))}}

def act(m: Model,s: U32,xs: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  Agent{q,b,c}=m
  T.epsilon_greedy(q,s,xs,mode,word)

def push(b: Buffer,x: Item) -> Buffer:
  match b:
    case Nil{}: [x]
    case y <> ys: y <> push(ys,x)

def target(b: Buffer,+gamma: F32,v: F32) -> F32:
  match b:
    case Nil{}: v
    case Item{s,a,r} <> tail: F32.add(r,F32.mul(gamma,target(tail,gamma,v)))

def oldest(+b: Buffer,q: T.Table,alpha: F32,+gamma: F32,v: F32) -> T.Table:
  match b:
    case Nil{}: q
    case Item{s,a,r} <> +tail: V.update(q,s,a,F32.add(r,F32.mul(gamma,target(tail,gamma,v))),alpha)

def flush(b: Buffer,q: T.Table,+alpha: F32,+gamma: F32,+v: F32) -> T.Table:
  match b:
    case Nil{}: q
    case +x <> +tail: flush(tail,oldest(x <> tail,q,alpha,gamma,v),alpha,gamma,v)

def shift(b: Buffer) -> Buffer:
  match b:
    case Nil{}: []
    case x <> tail: tail

def mature(ready: Bool,+b: Buffer,q: T.Table,c: Config,+s: U32,xs: List<&2,U32>) -> Model:
  match ready:
    case False{}: Agent{q,b,c}
    case True{}:
      Config{n,+alpha,+gamma}=c
      +table=q
      v=V.expected(table,s,xs)
      Agent{oldest(b,table,alpha,gamma,v),shift(b),Config{n,alpha,gamma}}

def accept(next: E.View<U32>,cut: Bool,b: Buffer,+q: T.Table,+c: Config) -> Model:
  match next cut c:
    case E.End{s} _ Config{n,+alpha,+gamma}: Agent{flush(b,q,alpha,gamma,0.0),[],Config{n,alpha,gamma}}
    case E.Open{s,xs} True{} Config{n,+alpha,+gamma}: Agent{flush(b,q,alpha,gamma,V.expected(q,s,xs)),[],Config{n,alpha,gamma}}
    case E.Open{s,xs} False{} Config{+n,alpha,gamma}:
      +buf=b
      mature(U32.is_ge(U32.from_nat(List.length(&2,Item,buf)),n),buf,q,Config{n,alpha,gamma},s,xs)

def learn(m: Model,event: E.Transition<U32>) -> Model:
  Agent{q,b,c}=m
  E.Transition{s,a,r,next,cut}=event
  accept(next,cut,push(b,Item{s,a,r}),q,c)

def finish(m: Model,reason: E.Stop) -> Model:
  Agent{q,b,+c}=m
  Config{n,alpha,gamma}=c
  Agent{flush(b,q,alpha,gamma,0.0),[],c}

def buffer(m: Model) -> Buffer:
  Agent{q,b,c}=m
  b
