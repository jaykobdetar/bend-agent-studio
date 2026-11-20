import Base

# Transport through the public bit payload, not decimal float input or U32.to_f32.
def as_f32(u: U32) -> F32:
  match u:
    case U32{word}:
      F32{word}

def probe(+a: U32, +b: U32) -> List<U32>:
  +x = as_f32(a)
  +y = as_f32(b)
  [F32.bits(x), F32.bits(y),
   F32.bits(F32.sin(x)), F32.bits(F32.cos(x)),
   F32.bits(F32.tanh(x)), F32.bits(F32.log(x)), F32.bits(F32.exp(x)),
   F32.bits(F32.sqrt(x)), F32.bits(F32.add(x, y)), F32.bits(F32.sub(x, y)),
   F32.bits(F32.mul(x, y)), F32.bits(F32.div(x, y)),
   F32.bits(F32.sub(F32.mul(x, y), 1.0))]

def paths(+a: U32, +b: U32) -> List<U32> & List<U32>:
  (probe(a, b), probe!(a, b))

def zeroes(n: Nat) -> String:
  match n:
    case 0n:
      ""
    case 1n+rest:
      "0" ++ zeroes(rest)

def hex8(a: U32) -> String:
  +s = U32.hex(a)
  zeroes(Nat.sub(8n, String.length(s))) ++ s

def words(xs: List<U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case Con{x, rest}:
      " " ++ hex8(x) ++ words(rest)

def display(+a: U32, +b: U32, pair: List<U32> & List<U32>) -> String:
  (host, parallel) = pair
  "S " ++ hex8(a) ++ " " ++ hex8(b) ++ " H" ++ words(host) ++ " P" ++ words(parallel)

def row(+a: U32, +b: U32) -> String:
  display(a, b, paths(a, b))

def parsed(ax: Maybe<&2, U32>, bx: Maybe<&2, U32>) -> IO(Unit):
  match ax bx:
    case Some{+a} Some{+b}:
      IO.print(row(a, b))
    case _ _:
      IO.die(Unit, 2, "expected decimal unsigned bit words")

def pairs(xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}:
      IO.exit(0)
    case Con{a, Con{b, rest}}:
      do IO<Unit>:
        parsed(U32.read(a), U32.read(b))
        pairs(rest)
    case _:
      IO.die(Unit, 2, "expected pairs of unsigned bit words")

def run(xs: List<String>) -> IO(Unit):
  match xs:
    case Con{_, rest}:
      pairs(rest)
    case _:
      IO.die(Unit, 2, "missing program argument")

def main() -> IO(Unit):
  do IO<Unit>:
    xs : List<String> <- IO.args()
    run(xs)
