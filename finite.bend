import Base

type Outcome is Data:
  Outcome{upper: U32, state: U32, reward: F32}

def first(hit: Bool, state: U32, reward: F32, rest: Unit -> Pair(U32, F32)) -> Pair(U32, F32):
  match hit:
    case True{}: (state, reward)
    case False{}: rest(Unit{})

def draw(outcomes: List<&2, Outcome>, +word: U32) -> Pair(U32, F32):
  match outcomes:
    case Nil{}: (0, 0.0)
    case Outcome{upper, state, reward} <> rest:
      first(U32.is_le(word, upper), state, reward, u => draw(rest, word))

def destination(result: Pair(U32, F32)) -> U32:
  (state, reward) = result
  state
