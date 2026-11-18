import Base
import ./engine.bend as E

# The player sees the light, while the number of rooms left stays in world state.
type Hall is Data:
  Hall{light: U32, remaining: Nat}

def reset(seed: U32) -> Hall:
  Hall{U32.and(seed, 1), 2n}

def view(state: Hall) -> E.View<U32>:
  match state:
    case Hall{light, 0n}:
      E.End{light}
    case Hall{light, 1n+rest}:
      E.Open{light, [0, 1]}

def step(state: Hall, action: U32, seed: U32) -> Pair(Hall, F32):
  match state:
    case Hall{light, 0n}:
      (Hall{light, 0n}, 0.0)
    case Hall{+light, 1n+rest}:
      reward = Bool.pick(F32, U32.is_eq(action, light), 1.0, 0.0)
      (Hall{U32.xor(light, 1), rest}, reward)

def world() -> E.World<Hall, U32>:
  E.World{reset, view, step}
