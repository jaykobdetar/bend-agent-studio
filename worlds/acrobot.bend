import Base
import ./engine.bend as E
import ./parameters.bend as P

# Book variant of Acrobot: unit masses/links and inertias, half-link
# centers of mass, gravity 9.8, RK4 with a constant torque over 0.2 s.
type State is Data:
  Acrobot{theta1: F32, theta2: F32, velocity1: F32, velocity2: F32}

def Observation() -> Data: State

def jitter(seed: U32, salt: U32) -> F32:
  u = F32.div(U32.to_f32(U32.and(E.mix_word(U32.xor(seed,salt)),16777215)),16777216.0)
  F32.sub(F32.mul(0.2,u),0.1)

def reset(+seed: U32) -> State:
  Acrobot{jitter(seed,37),jitter(seed,173),jitter(seed,953),jitter(seed,2741)}

def goal(+a: F32, b: F32) -> Bool:
  F32.is_lt(F32.add(F32.cos(a),F32.cos(F32.add(a,b))),F32.neg(1.0))

def reached(done: Bool, state: State) -> E.View<Observation>:
  match done:
    case True{}: E.End{state}
    case False{}: E.Open{state,[0,1,2]}

def view(state: State) -> E.View<Observation>:
  Acrobot{+a,+b,v,w} = state
  reached(goal(a,b),Acrobot{a,b,v,w})

def torque(action: U32) -> F32:
  match action:
    case 0: F32.neg(1.0)
    case 2: 1.0
    case _: 0.0

def slopes(state: State, u: F32) -> State:
  Acrobot{+a,+b,+v,+w} = state
  +c = F32.cos(b)
  +s = F32.sin(b)
  +d1 = F32.add(3.5,c)
  +d2 = F32.add(1.25,F32.mul(0.5,c))
  +g2 = F32.mul(4.9,F32.sin(F32.add(a,b)))
  +g1 = F32.add(F32.sub(F32.mul(14.7,F32.sin(a)),
    F32.mul(s,F32.add(F32.mul(0.5,F32.square(w)),F32.mul(w,v)))),g2)
  +a2 = F32.div(F32.sub(F32.sub(F32.add(u,F32.mul(F32.div(d2,d1),g1)),
    F32.mul(0.5,F32.mul(F32.square(v),s))),g2),
    F32.sub(1.25,F32.div(F32.square(d2),d1)))
  a1 = F32.neg(F32.div(F32.add(F32.mul(d2,a2),g1),d1))
  Acrobot{v,w,a1,a2}

def shift(state: State, delta: State, +k: F32) -> State:
  Acrobot{a,b,v,w} = state
  Acrobot{da,db,dv,dw} = delta
  Acrobot{F32.add(a,F32.mul(k,da)),F32.add(b,F32.mul(k,db)),
    F32.add(v,F32.mul(k,dv)),F32.add(w,F32.mul(k,dw))}

def rk4(+state: State,+u: F32) -> State:
  +k1 = slopes(state,u)
  +k2 = slopes(shift(state,k1,0.1),u)
  +k3 = slopes(shift(state,k2,0.1),u)
  k4 = slopes(shift(state,k3,0.2),u)
  total = shift(shift(shift(k1,k2,2.0),k3,2.0),k4,1.0)
  shift(state,total,0.03333333333333333)

def wrap(+angle: F32) -> F32:
  +pi = {3.141592653589793 : F32}
  +tau = {6.283185307179586 : F32}
  Bool.pick(F32,F32.is_le(F32.abs(angle),pi),angle,
    F32.sub(angle,F32.mul(tau,F32.floor(F32.div(F32.add(angle,pi),tau)))))

def bound(v: F32,+limit: F32) -> F32: F32.max(F32.neg(limit),F32.min(limit,v))

def settle(state: State) -> Pair(State,F32):
  Acrobot{a,b,v,w} = state
  +w1 = wrap(a)
  +w2 = wrap(b)
  reward = Bool.pick(F32,goal(w1,w2),0.0,F32.neg(1.0))
  (Acrobot{w1,w2,bound(v,12.566370614359172),bound(w,28.274333882308138)},reward)

def step(state: State, action: U32, word: U32) -> Pair(State,F32):
  settle(rk4(state,torque(action)))

def world(params: P.Parameters) -> E.World<State,Observation>:
  E.World{seed => reset(seed),view,step}
