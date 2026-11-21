import Base
import ../worlds/chess.bend as C
import ../core/arena.bend as A

def apply(actions: List<&2,U32>,state: C.State) -> C.State:
  match actions:
    case []: state
    case a<>rest: apply(rest,C.game_move(state,a,0))

def cycle() -> List<&2,U32>:
  [C.encode(6,37,0),C.encode(118,85,0),C.encode(37,6,0),C.encode(85,118,0)]

def repeat(depth: Nat,game: C.State) -> C.State:
  match depth:
    case 0n: game
    case 1n+rest: repeat(rest,apply(cycle(),game))

def before_third() -> C.State:
  apply([C.encode(6,37,0),C.encode(118,85,0),C.encode(37,6,0)],repeat(1n,C.reset(0)))

def fifty(clock: U32) -> C.State:
  C.Live{C.Chess{C.Ranks{6,4,16,0,0,0,0,3758096384},0,0,127,0,119,clock},[]}

def no_mate(board: C.Board) -> Bool: C.dead(board)

def ep_key(pinned: Bool,ep: U32) -> C.Repetition:
  # White e5 pawn can capture d6, unless the black rook on e8 pins it.
  rook=Bool.pick(U32,pinned,786432,0)
  C.repetition(C.Chess{C.Ranks{393216,0,0,0,102400,0,0,U32.add(3758096384,rook)},0,0,ep,4,119,0})

def right_key(r: U32) -> C.Repetition:
  C.repetition(C.Chess{C.Ranks{1074135044,0,0,0,0,0,0,917504},0,r,127,4,116,0})


def position(game: C.State) -> A.Position: C.game_position(game)
def step(game: C.State,a: U32) -> C.State: C.game_move(game,a,0)
def reset() -> C.State: C.reset(0)
