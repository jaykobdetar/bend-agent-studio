import Base
import ./engine.bend as E

# At the dock, deliver locally for 1 or buy a ferry ticket for 0.25.
# A ferry delivery pays 4 after two more actions.
type Stage is Data:
  Dock{}
  Aboard{}
  Destination{}
  Delivered{}

def reset(seed: U32) -> Stage:
  Dock{}

def view(state: Stage) -> E.View<U32>:
  match state:
    case Dock{}: E.Open{0, [4, 8]}
    case Aboard{}: E.Open{1, [12]}
    case Destination{}: E.Open{2, [16]}
    case Delivered{}: E.End{3}

def step(state: Stage, action: U32, word: U32) -> Pair(Stage, F32):
  match state action:
    case Dock{} 4: (Delivered{}, 1.0)
    case Dock{} 8: (Aboard{}, F32.sub(0.0, 0.25))
    case Aboard{} 12: (Destination{}, 0.0)
    case Destination{} 16: (Delivered{}, 4.0)
    case other _: (other, 0.0)

def world() -> E.World<Stage, U32>:
  E.World{reset, view, step}
