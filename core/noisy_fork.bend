import Base
import ./engine.bend as E

# A discrete version of the maximization-bias example. At the fork, cash
# out for zero or enter a room with ten individually noisy, losing choices.
type State is Data:
  Fork{}
  Room{}
  Finished{}

def reset(seed: U32) -> State: Fork{}

def view(state: State) -> E.View<U32>:
  match state:
    case Fork{}: E.Open{0, [7, 2]}
    case Room{}: E.Open{1, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]}
    case Finished{}: E.End{2}

def step(state: State, action: U32, word: U32) -> Pair(State, F32):
  match state action:
    case Fork{} 7: (Room{}, 0.0)
    case Fork{} 2: (Finished{}, 0.0)
    case Room{} _:
      # P(+1)=7/16 and P(-1)=9/16, so each choice has mean -1/8.
      (Finished{}, Bool.pick(F32, U32.is_lt(U32.and(word, 15), 7), 1.0, F32.sub(0.0, 1.0)))
    case other _: (other, 0.0)

def world() -> E.World<State, U32>: E.World{reset, view, step}
