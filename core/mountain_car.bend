import Base
import ./engine.bend as E

# Mountain Car uses the conventional deterministic position/velocity dynamics.
# Reset randomness and action randomness have separate streams.
type State is Data:
  Car{position: F32, velocity: F32}

def reset(seed: U32) -> State:
  u = F32.div(U32.to_f32(U32.and(E.mix_word(U32.xor(seed, 668265263)), 1048575)), 1048576.0)
  Car{F32.add(F32.neg(0.6), F32.mul(0.2, u)), 0.0}

def classify(goal: Bool, state: State) -> E.View<State>:
  match goal:
    case True{}: E.End{state}
    case False{}: E.Open{state, [0, 1, 2]}

def view(state: State) -> E.View<State>:
  Car{+x, v} = state
  classify(F32.is_ge(x, 0.5), Car{x, v})

def step(state: State, action: U32, word: U32) -> Pair(State, F32):
  Car{+x, v} = state
  push = F32.mul(0.001, F32.sub(U32.to_f32(action), 1.0))
  gravity = F32.mul(0.0025, F32.cos(F32.mul(3.0, x)))
  +speed = F32.max(F32.neg(0.07), F32.min(0.07, F32.add(v, F32.sub(push, gravity))))
  +position = F32.max(F32.neg(1.2), F32.min(0.6, F32.add(x, speed)))
  wall = F32.is_le(position, F32.neg(1.2)) && F32.is_lt(speed, 0.0)
  (Car{position, Bool.pick(F32, wall, 0.0, speed)}, F32.neg(1.0))

def world() -> E.World<State, State>: E.World{reset, view, step}
