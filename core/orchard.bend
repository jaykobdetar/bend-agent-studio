import Base
import ./engine.bend as E

# One harvest per episode. Orchard IDs 3, 17, and 42 pay one fruit with
# probabilities 1/4, 1/2, and 3/4 respectively.
def reset(seed: U32) -> Bool:
  False{}

def view(done: Bool) -> E.View<U32>:
  match done:
    case False{}:
      E.Open{0, [3, 17, 42]}
    case True{}:
      E.End{0}

def threshold(action: U32) -> U32:
  match action:
    case 3: 1
    case 17: 2
    case 42: 3
    case _: 0

def step(done: Bool, action: U32, word: U32) -> Pair(Bool, F32):
  win = U32.is_lt(U32.and(word, 3), threshold(action))
  (True{}, Bool.pick(F32, win, 1.0, 0.0))

def world() -> E.World<Bool, U32>:
  E.World{reset, view, step}
