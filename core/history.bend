import Base
import ./engine.bend as E

# The encoder receives public observations and transitions. The latent world
# state stays inside the adapter. Each reset starts a fresh episode memory.
type State<-S: Data, -H: Data> is Data:
  Remembered{world: S, memory: H}

def observation(-O: Data, view: E.View<O>) -> O:
  match view:
    case E.Open{obs, legal}: obs
    case E.End{obs}: obs

def encode_view(-O: Data, -H: Data, -F: Data, encode: H -> O -> F, h: H, view: E.View<O>) -> E.View<F>:
  match view:
    case E.Open{obs, legal}: E.Open{encode(h, obs), legal}
    case E.End{obs}: E.End{encode(h, obs)}

def reset(-S: Data, -H: Data, reset_world: U32 -> S, initial: H, seed: U32) -> State<S,H>:
  Remembered{reset_world(seed), initial}

def inspect(-S: Data, -O: Data, -H: Data, -F: Data, show: S -> E.View<O>, encode: H -> O -> F,
            state: State<S,H>) -> E.View<F>:
  Remembered{s, h} = state
  encode_view(O, H, F, encode, h, show(s))

def moved(-S: Data, -O: Data, -H: Data, show: S -> E.View<O>, remember: H -> O -> U32 -> F32 -> O -> H,
          h: H, before: O, action: U32, result: Pair(S,F32)) -> Pair(State<S,H>,F32):
  (+after, +reward) = result
  next = observation(O, show(after))
  (Remembered{after, remember(h, before, action, reward, next)}, reward)

def advance(~S: Data, ~O: Data, ~H: Data, ~show: S -> E.View<O>, ~step: S -> U32 -> U32 -> Pair(S,F32),
            ~remember: H -> O -> U32 -> F32 -> O -> H, state: State<S,H>, +action: U32, word: U32) -> Pair(State<S,H>,F32):
  Remembered{+before, h} = state
  moved(S, O, H, show, remember, h, observation(O, show(before)), action, step(before, action, word))

def wrap(~S: Data, ~O: Data, ~H: Data, ~F: Data, ~start: U32 -> S, ~show: S -> E.View<O>,
         ~step: S -> U32 -> U32 -> Pair(S,F32), ~initial: H, ~encode: H -> O -> F,
         ~remember: H -> O -> U32 -> F32 -> O -> H) -> E.World<State<S,H>,F>:
  E.World{seed => reset(S, H, start, initial, seed), s => inspect(S, O, H, F, show, encode, s),
    s => a => w => advance(~S, ~O, ~H, ~show, ~step, ~remember, s, a, w)}

type Previous is Data:
  First{}
  Previous{observation: U32}

def remember_previous(memory: Previous, before: U32, action: U32, reward: F32, next: U32) -> Previous:
  Previous{before}

# rank is a zero-based lookup over the world's distinct public observations.
def history_id(~rank: U32 -> U32, count: U32, memory: Previous, current: U32) -> U32:
  match memory:
    case First{}: rank(current)
    case Previous{before}: U32.add(U32.mul(U32.add(rank(before), 1), count), rank(current))
