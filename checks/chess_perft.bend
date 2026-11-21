import Base
import ../worlds/chess.bend as C
import ../core/arena.bend as A

# Perft deliberately ignores draw adjudication and counts legal move sequences.
def children(+depth: Nat,moves: List<&2,U32>,+state: C.BoardState) -> U32:
  match depth moves:
    case 0n _: 1
    case 1n _: U32.from_nat(List.length(&2,U32,moves))
    case 1n+left Nil{}: 0
    case 1n+left Con{a,rest}:
      +next=C.move(state,a,0)
      U32.add(children(left,C.legal(next),next),children(depth,rest,state))

def perft(depth: Nat,+state: C.BoardState) -> U32:
  children(depth,C.legal(state),state)

def score(state: C.BoardState) -> F32:
  A.payoff(C.position(state))

def ended(pos: A.Position) -> Bool:
  match pos:
    case A.Outcome{r}: True{}
    case _: False{}

def terminal(state: C.BoardState) -> Bool:
  ended(C.position(state))

def play(actions: List<&2,U32>,state: C.BoardState) -> C.BoardState:
  match actions:
    case []: state
    case a<>rest: play(rest,C.move(state,a,0))

# FEN: r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 (full-move number omitted).
def kiwipete() -> C.BoardState:
  C.Chess{C.Ranks{1074135044,286470417,2421162496,65680,135168,162070699,194877705,3222142988},0,15,127,4,116,0}

# FEN: 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 (full-move number omitted).
def endgame() -> C.BoardState:
  C.Chess{C.Ranks{0,16842752,0,3767533632,3221225494,36864,2304,0},0,0,127,64,55,0}

# FEN: r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 (full-move number omitted).
def promotions() -> C.BoardState:
  C.Chess{C.Ranks{104878084,285216913,2097165,65843,26,731906224,2576390545,3222142988},0,12,127,6,116,0}

# FEN: 7k/5Q2/6K1/8/8/8/8/8 b - - 0 (full-move number omitted).
def stalemate() -> C.BoardState:
  C.Chess{C.Ranks{0,0,0,0,0,100663296,5242880,3758096384},8,0,127,86,119,0}

# FEN: 7k/6Q1/6K1/8/8/8/8/8 b - - 150 (full-move number omitted).
def white_mates() -> C.BoardState:
  C.Chess{C.Ranks{0,0,0,0,0,100663296,83886080,3758096384},8,0,127,86,119,150}

# FEN: 7k/8/6K1/8/8/8/R7/8 b - - 150 (full-move number omitted).
def seventy_five() -> C.BoardState:
  C.Chess{C.Ranks{0,4,0,0,0,100663296,0,3758096384},8,0,127,86,119,150}


def bare_kings() -> C.BoardState:
  C.Chess{C.Ranks{6,0,0,0,0,0,0,3758096384},0,0,127,0,119,0}

def main() -> List<&2,U32>:
  [perft(1n,C.start()),perft(2n,C.start()),perft(3n,C.start()),
   perft(1n,kiwipete()),perft(2n,kiwipete()),perft(3n,kiwipete()),
   perft(3n,endgame()),perft(2n,promotions()),perft(3n,promotions()),
   Bool.pick(U32,terminal(bare_kings()),1,0),
   Bool.pick(U32,terminal(stalemate()) && F32.is_eq(score(stalemate()),0.0),1,0),
   Bool.pick(U32,terminal(white_mates()) && F32.is_eq(score(white_mates()),1.0),1,0),
   Bool.pick(U32,terminal(seventy_five()) && F32.is_eq(score(seventy_five()),0.0),1,0),
   Bool.pick(U32,F32.is_eq(score(play([C.encode(21,37,0),C.encode(100,68,0),
     C.encode(22,54,0),C.encode(115,55,0)],C.start())),F32.neg(1.0)),1,0)]
