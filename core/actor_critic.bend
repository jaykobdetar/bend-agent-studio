import Base
import ./engine.bend as E
import ./cartpole.bend as Cart
import ./tabular.bend as T

# The actor has a binary logistic output, and the critic estimates V(s).
# Their small shared hidden layer uses the old output weights for both
# gradients. The linear baseline uses the four identity features directly.
type Method is Data:
  RandomPole{}
  LinearAC{}
  NetworkAC{}

type Settings is Data:
  ACSettings{method: Method, actor_rate: F32, critic_rate: F32, gamma: F32}

type Vector is Data:
  Vector{x: F32, v: F32, angle: F32, speed: F32}

type UnitWeights is Data:
  Neuron{input: Vector, bias: F32, actor: F32, critic: F32}

type Model is Data:
  Network{settings: Settings, units: List<&2,UnitWeights>, logit_bias: F32, value_bias: F32}

def clip(x: F32) -> F32: F32.max(F32.neg(2.0),F32.min(2.0,x))

def features(state: Cart.State) -> Vector:
  Cart.Cart{x,v,t,w}=state
  Vector{clip(F32.div(x,2.4)),clip(F32.div(v,2.0)),clip(F32.div(t,0.20943951)),clip(F32.div(w,2.5))}

def dot(a: Vector,b: Vector) -> F32:
  match a b:
    case Vector{x,v,t,w} Vector{a,b,c,d}:
      F32.add(F32.add(F32.mul(x,a),F32.mul(v,b)),F32.add(F32.mul(t,c),F32.mul(w,d)))

def add_scaled(a: Vector,b: Vector,+scale: F32) -> Vector:
  match a b:
    case Vector{x,v,t,w} Vector{a,b,c,d}:
      Vector{F32.add(x,F32.mul(scale,a)),F32.add(v,F32.mul(scale,b)),
             F32.add(t,F32.mul(scale,c)),F32.add(w,F32.mul(scale,d))}

def weight(seed: U32, salt: U32) -> F32:
  u=F32.div(U32.to_f32(U32.and(E.mix_word(U32.xor(seed,salt)),16777215)),16777216.0)
  F32.sub(F32.mul(1.4,u),0.7)

def units(n: Nat, +seed: U32) -> List<&2,UnitWeights>:
  match n:
    case 0n: []
    case 1n++rest:
      +s=E.mix_word(U32.add(seed,U32.from_nat(rest)))
      Neuron{Vector{weight(s,1),weight(s,2),weight(s,3),weight(s,4)},weight(s,5),0.0,0.0} <> units(rest,seed)

def initial(settings: Settings, seed: U32) -> Model:
  match settings:
    case ACSettings{NetworkAC{},a,c,g}:
      Network{ACSettings{NetworkAC{},a,c,g},units(8n,seed),0.0,0.0}
    case cfg:
      Network{cfg,[Neuron{Vector{1.0,0.0,0.0,0.0},0.0,0.0,0.0},Neuron{Vector{0.0,1.0,0.0,0.0},0.0,0.0,0.0},
        Neuron{Vector{0.0,0.0,1.0,0.0},0.0,0.0,0.0},Neuron{Vector{0.0,0.0,0.0,1.0},0.0,0.0,0.0}],0.0,0.0}

def activation(method: Method, input: Vector, bias: F32, features: Vector) -> F32:
  match method:
    case NetworkAC{}: F32.tanh(F32.add(dot(input,features),bias))
    case _: dot(input,features)

type Outputs is Data:
  Outputs{logit: F32, value: F32}

def forward(units: List<&2,UnitWeights>, +method: Method, +features: Vector, logit: F32, value: F32) -> Outputs:
  match units:
    case Nil{}: Outputs{logit,value}
    case Neuron{input,bias,actor,critic} <> rest:
      +h=activation(method,input,bias,features)
      forward(rest,method,features,F32.add(logit,F32.mul(actor,h)),F32.add(value,F32.mul(critic,h)))

def outputs(model: Model, state: Cart.State) -> Outputs:
  Network{ACSettings{method,a,c,g},units,l,v}=model
  forward(units,method,features(state),l,v)

def sigmoid(logit: F32) -> F32:
  F32.mul(0.5,F32.add(1.0,F32.tanh(F32.mul(0.5,logit))))

def choose(mode: E.Mode, output: Outputs, word: U32) -> U32:
  match mode output:
    case E.Evaluate{} Outputs{logit,value}: Bool.to_u32(F32.is_gt(logit,0.0))
    case E.Train{} Outputs{logit,value}:
      u=F32.div(U32.to_f32(U32.and(word,16777215)),16777216.0)
      Bool.to_u32(F32.is_lt(u,sigmoid(logit)))

def act(model: Model, state: Cart.State, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  match model:
    case Network{ACSettings{RandomPole{},a,c,g},units,l,v}: T.random_action(actions,word)
    case other: choose(mode,outputs(other,state),word)

def value(output: Outputs) -> F32:
  Outputs{logit,v}=output
  v

def continuation(model: Model, next: E.View<Cart.State>) -> F32:
  match next:
    case E.End{s}: 0.0
    case E.Open{s,actions}: value(outputs(model,s))

def hidden_delta(method: Method, +h: F32, old_actor: F32, old_critic: F32, da: F32, dc: F32) -> F32:
  match method:
    case NetworkAC{}:
      F32.mul(F32.sub(1.0,F32.mul(h,h)),F32.add(F32.mul(old_actor,da),F32.mul(old_critic,dc)))
    case _: 0.0

def train_units(units: List<&2,UnitWeights>, +method: Method, +x: Vector, +da: F32, +dc: F32) -> List<&2,UnitWeights>:
  match units:
    case Nil{}: []
    case Neuron{+input,+bias,+actor,+critic} <> rest:
      +h=activation(method,input,bias,x)
      +dh=hidden_delta(method,h,actor,critic,da,dc)
      Neuron{add_scaled(input,x,dh),F32.add(bias,dh),F32.add(actor,F32.mul(da,h)),F32.add(critic,F32.mul(dc,h))}
        <> train_units(rest,method,x,da,dc)

def adjust(model: Model, x: Vector, current: Outputs, action: U32, target: F32) -> Model:
  match model current:
    case Network{ACSettings{+method,+ar,+cr,g},units,l,v} Outputs{logit,estimate}:
      +delta=F32.sub(target,estimate)
      +da=F32.mul(ar,F32.mul(delta,F32.sub(U32.to_f32(action),sigmoid(logit))))
      +dc=F32.mul(cr,delta)
      Network{ACSettings{method,ar,cr,g},train_units(units,method,x,da,dc),F32.add(l,da),F32.add(v,dc)}

def update(+model: Model, gamma: F32, event: E.Transition<Cart.State>) -> Model:
  E.Transition{+state,action,reward,next,truncated}=event
  target=F32.add(reward,F32.mul(gamma,continuation(model,next)))
  adjust(model,features(state),outputs(model,state),action,target)

def learn(model: Model, event: E.Transition<Cart.State>) -> Model:
  match model:
    case Network{ACSettings{RandomPole{},a,c,g},units,l,v}: Network{ACSettings{RandomPole{},a,c,g},units,l,v}
    case Network{ACSettings{m,a,c,+g},units,l,v}:
      update(Network{ACSettings{m,a,c,g},units,l,v},g,event)

def episode(mode: E.Mode, model: Model, seed: U32, limit: Nat) -> E.Report<Model>:
  E.episode(~Cart.State,~Cart.State,~Model,~E.Hooks{Cart.world(),act,learn},mode,model,seed,limit)
