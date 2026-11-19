import Base
import ./engine.bend as E

# The entrance (0) leads east to a hall (1). A key is in the alcove
# north of the hall (2). Carry it back to unlock the east vault (3).
type State is Data:
  Cell{room: U32, key: Bool}

def reset(seed: U32) -> State:
  Cell{0, False{}}

def view(state: State) -> E.View<U32>:
  match state:
    case Cell{0, False{}}: E.Open{0, [20]}
    case Cell{0, True{}}: E.Open{4, [20]}
    case Cell{1, False{}}: E.Open{1, [10, 30]}
    case Cell{1, True{}}: E.Open{5, [10, 30, 20]}
    case Cell{2, False{}}: E.Open{2, [40, 50]}
    case Cell{2, True{}}: E.Open{6, [40]}
    case Cell{r, k}: E.End{7}

def step(state: State, action: U32, word: U32) -> Pair(State, F32):
  match state action:
    case Cell{0, k} 20: (Cell{1, k}, F32.sub(0.0, 1.0))
    case Cell{1, k} 10: (Cell{0, k}, F32.sub(0.0, 1.0))
    case Cell{1, k} 30: (Cell{2, k}, F32.sub(0.0, 1.0))
    case Cell{1, True{}} 20: (Cell{3, True{}}, 8.0)
    case Cell{2, k} 40: (Cell{1, k}, F32.sub(0.0, 1.0))
    case Cell{2, False{}} 50: (Cell{2, True{}}, F32.sub(0.0, 1.0))
    case other _: (other, 0.0)

def world() -> E.World<State, U32>:
  E.World{reset, view, step}
