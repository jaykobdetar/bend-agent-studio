import Base
import ./engine.bend as E

# An alternating game pays a terminal outcome to the first seat. Its second
# seat has the opposite payoff. Extra turns are permitted and explicitly tagged.
type Signal is Data:
  Mover{second: Bool, key: U32}
  Over{}

type Position is Data:
  Turn{second: Bool, key: U32, legal: List<&2,U32>}
  Outcome{first: F32}

def view(pos: Position) -> E.View<Signal>:
  match pos:
    case Turn{side,key,legal}: E.Open{Mover{side,key},legal}
    case Outcome{payoff}: E.End{Over{}}

def payoff(pos: Position) -> F32:
  match pos:
    case Turn{side,key,legal}: 0.0
    case Outcome{first}: first

def moved(~S: Data, ~position: S -> Position, +next: S) -> Pair(S,F32):
  (next,payoff(position(next)))

def world(~S: Data, ~position: S -> Position, ~move: S -> U32 -> U32 -> S,
          reset: U32 -> S) -> E.World<S,Signal>:
  E.World{reset,s => view(position(s)),s => a => w => moved(~S,~position,move(s,a,w))}

def perspective(second: Bool, reward: F32) -> F32:
  match second:
    case True{}: F32.neg(reward)
    case False{}: reward

def orient(next_opponent: Bool, value: F32) -> F32: perspective(next_opponent,value)
