import Base
import ./tabular.bend as T
import ./weights.bend as W

# Paths stop at the highest set bit. Each row reuses the standard sparse
# action table with local observation ID zero.
type Tree is Data:
  Empty{}
  Node{row: T.Table, low: Tree, high: Tree}

def address(fuel: Nat, key: U32) -> W.Path:
  match fuel key:
    case 0n _: W.Here{}
    case 1n+n 0: W.Here{}
    case 1n+n +k: W.branch(U32.is_ne(U32.and(k,1),0),address(n,U32.shr(k)))

def read(at: W.Path, tree: Tree) -> T.Table:
  match at tree:
    case _ Empty{}: []
    case W.Here{} Node{row,lo,hi}: row
    case W.Low{p} Node{row,lo,hi}: read(p,lo)
    case W.High{p} Node{row,lo,hi}: read(p,hi)

def put(at: W.Path, tree: Tree, row: T.Table) -> Tree:
  match at tree:
    case W.Here{} Empty{}: Node{row,Empty{},Empty{}}
    case W.Here{} Node{old,lo,hi}: Node{row,lo,hi}
    case W.Low{p} Empty{}: Node{[],put(p,Empty{},row),Empty{}}
    case W.High{p} Empty{}: Node{[],Empty{},put(p,Empty{},row)}
    case W.Low{p} Node{old,lo,hi}: Node{old,put(p,lo,row),hi}
    case W.High{p} Node{old,lo,hi}: Node{old,lo,put(p,hi,row)}

def get(key: U32, tree: Tree) -> T.Table: read(address(32n,key),tree)

def update(+tree: Tree, key: U32, action: U32, rate: T.Rate, target: F32) -> Tree:
  +at=address(32n,key)
  put(at,tree,T.adjust(read(at,tree),0,action,rate,target))
