import Base
import ./engine.bend as E

# A small Cliff Walking grid. Rows run north to south, five cells per row.
#  0  1  2  3  4
#  5  6  7  8  9
#  S  ~  ~  ~  G
# A fall costs 100 and returns the walker to S in the same episode.
def reset(seed: U32) -> U32:
  10

def allow(ok: Bool, action: U32, rest: List<&2, U32>) -> List<&2, U32>:
  match ok:
    case True{}: action <> rest
    case False{}: rest

def view(+cell: U32) -> E.View<U32>:
  match cell:
    case 14: E.End{14}
    case +other:
      +col = U32.mod(other, 5)
      south = allow(U32.is_lt(other, 10), 40, [])
      east = allow(U32.is_lt(col, 4), 20, south)
      west = allow(U32.is_gt(col, 0), 10, east)
      E.Open{other, allow(U32.is_ge(other, 5), 30, west)}

def destination(cell: U32, action: U32) -> U32:
  match action:
    case 10: U32.sub(cell, 1)
    case 20: U32.add(cell, 1)
    case 30: U32.sub(cell, 5)
    case 40: U32.add(cell, 5)
    case _: cell

def land(fall: Bool, cell: U32) -> Pair(U32, F32):
  match fall:
    case True{}: (10, F32.sub(0.0, 100.0))
    case False{}: (cell, F32.sub(0.0, 1.0))

def step(cell: U32, action: U32, word: U32) -> Pair(U32, F32):
  +next = destination(cell, action)
  land(U32.is_gt(next, 10) && U32.is_lt(next, 14), next)

def world() -> E.World<U32, U32>:
  E.World{reset, c => view(c), step}
