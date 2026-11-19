import Base

# Ten-bit feature addresses share immutable branches. A leaf holds the
# three action weights for one feature, so one traversal reads all actions.
type Row is Data:
  Weights{left: F32, coast: F32, right: F32}

type Tree is Data:
  Vacant{}
  Leaf{row: Row}
  Branch{low: Tree, high: Tree}

type Path is Data:
  Here{}
  Low{rest: Path}
  High{rest: Path}

def branch(high: Bool, rest: Path) -> Path:
  match high:
    case True{}: High{rest}
    case False{}: Low{rest}

def address(bits: Nat, +key: U32) -> Path:
  match bits:
    case 0n: Here{}
    case 1n+rest:
      branch(U32.is_ne(U32.and(key, 1), 0), address(rest, U32.shr(key)))

def low(tree: Tree) -> Tree:
  match tree:
    case Branch{l, r}: l
    case _: Vacant{}

def high(tree: Tree) -> Tree:
  match tree:
    case Branch{l, r}: r
    case _: Vacant{}

def leaf(tree: Tree) -> Row:
  match tree:
    case Leaf{r}: r
    case _: Weights{0.0, 0.0, 0.0}

def read(at: Path, tree: Tree) -> Row:
  match at:
    case Here{}: leaf(tree)
    case Low{p}: read(p, low(tree))
    case High{p}: read(p, high(tree))

def put(at: Path, +tree: Tree, value: Row) -> Tree:
  match at:
    case Here{}: Leaf{value}
    case Low{p}: Branch{put(p, low(tree), value), high(tree)}
    case High{p}: Branch{low(tree), put(p, high(tree), value)}

def plus(a: Row, b: Row) -> Row:
  match a b:
    case Weights{l, c, r} Weights{x, y, z}:
      Weights{F32.add(l, x), F32.add(c, y), F32.add(r, z)}

def add_action(row: Row, action: U32, delta: F32) -> Row:
  match row action:
    case Weights{l, c, r} 0: Weights{F32.add(l, delta), c, r}
    case Weights{l, c, r} 1: Weights{l, F32.add(c, delta), r}
    case Weights{l, c, r} 2: Weights{l, c, F32.add(r, delta)}
    case other _: other

def action_value(row: Row, action: U32) -> F32:
  match row action:
    case Weights{l, c, r} 0: l
    case Weights{l, c, r} 1: c
    case Weights{l, c, r} 2: r
    case _ _: 0.0
