
# Only a raw-word CLI driver; prior candidate definitions are an immutable prefix.
def tc_cli_zeroes(n: Nat) -> String:
  match n:
    case 0n:
      ""
    case 1n+rest:
      "0" ++ tc_cli_zeroes(rest)

def tc_cli_hex(a: U32) -> String:
  +s = U32.hex(a)
  tc_cli_zeroes(Nat.sub(8n, String.length(s))) ++ s

def tc_cli_result(result: Maybe<&2, U32>) -> String:
  match result:
    case Some{x}:
      tc_cli_hex(x)
    case None{}:
      "None"

def tc_cli_print(parsed: Maybe<&2, U32>) -> IO(Unit):
  match parsed:
    case Some{+x}:
      IO.print(tc_cli_hex(x) ++ " " ++ tc_cli_result(tanh_portable(x)))
    case None{}:
      IO.die(Unit, 1, "expected u32 word")

def tc_cli_loop(xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}:
      IO.exit(0)
    case Con{raw, rest}:
      do IO<Unit>:
        tc_cli_print(U32.read(raw))
        tc_cli_loop(rest)

def tc_cli_start(xs: List<String>) -> IO(Unit):
  match xs:
    case Con{_, rest}:
      tc_cli_loop(rest)
    case Nil{}:
      IO.die(Unit, 1, "expected argv")

def main() -> IO(Unit):
  do IO<Unit>:
    xs : List<String> <- IO.args()
    tc_cli_start(xs)
