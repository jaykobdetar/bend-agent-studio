import Base
import ./engine.bend as E

# CartPole, explicit Euler, 0.02 s per move. Natural termination means
# the cart or pole left its allowed range. Reaching the time limit is a success.
type State is Data:
  Cart{x: F32, velocity: F32, angle: F32, angular_velocity: F32}

def sample(seed: U32, salt: U32) -> F32:
  u = F32.div(U32.to_f32(U32.and(E.mix_word(U32.xor(seed,salt)),16777215)),16777216.0)
  F32.sub(F32.mul(0.1,u),0.05)

def reset(+seed: U32) -> State:
  Cart{sample(seed,11),sample(seed,97),sample(seed,1049),sample(seed,65537)}

def classify(failed: Bool, state: State) -> E.View<State>:
  match failed:
    case True{}: E.End{state}
    case False{}: E.Open{state,[0,1]}

def view(state: State) -> E.View<State>:
  Cart{+x,v,+angle,w}=state
  failed=F32.is_gt(F32.abs(x),2.4) || F32.is_gt(F32.abs(angle),0.20943951)
  classify(failed,Cart{x,v,angle,w})

def step(state: State, action: U32, word: U32) -> Pair(State,F32):
  Cart{x,+v,+theta,+w}=state
  force=Bool.pick(F32,U32.is_eq(action,0),F32.neg(10.0),10.0)
  +cosine=F32.cos(theta)
  +sine=F32.sin(theta)
  +temp=F32.div(F32.add(force,F32.mul(0.05,F32.mul(F32.square(w),sine))),1.1)
  denom=F32.mul(0.5,F32.sub(F32.div(4.0,3.0),F32.div(F32.mul(0.1,F32.square(cosine)),1.1)))
  +angular_acc=F32.div(F32.sub(F32.mul(9.8,sine),F32.mul(cosine,temp)),denom)
  cart_acc=F32.sub(temp,F32.div(F32.mul(0.05,F32.mul(angular_acc,cosine)),1.1))
  (Cart{F32.add(x,F32.mul(0.02,v)),F32.add(v,F32.mul(0.02,cart_acc)),
        F32.add(theta,F32.mul(0.02,w)),F32.add(w,F32.mul(0.02,angular_acc))},1.0)

def world() -> E.World<State,State>: E.World{s => reset(s),view,step}
