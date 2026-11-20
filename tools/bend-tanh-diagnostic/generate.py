"""Combine verified scratch components; adapt only output record transport."""
from pathlib import Path
p = Path(__file__).resolve().parent
A=[f"a{i}" for i in range(8)]
B=[f"b{i}" for i in range(8)]
def args(xs): return ", ".join(xs)
def wide(xs): return "RatioWide{" + args(xs) + "}"
def shared(xs,n=None): return ["+"+x if n is None or i<n else x for i,x in enumerate(xs)]
def uor(xs):
    if len(xs)==1: return xs[0]
    m=len(xs)//2
    return f"U32.or({uor(xs[:m])}, {uor(xs[m:])})"
print((p/"ratio.bend.in").read_text())
for name in ("mul", "small"):
    s=(p/(name+".bend.in")).read_text()
    assert s.count("import Base")==1
    s=s.replace("import Base","").replace("List<&2, U32>", "RatioWord")
    for prefix in ("q","u"):
        q=[prefix+str(i) for i in range(8)]
        assert s.count("["+args(q)+"]")==1
        s=s.replace("["+args(q)+"]",wide(q))
    print(s)
print("""
type TCEdges is Data:
  TCBounds{lo: RatioWord, hi: RatioWord}
type TCPhase is Data:
  TCSeries{terms: TCEdges, sums: TCEdges}

def tc_mul(p: U32, a: RatioWord, b: RatioWord) -> Maybe<&2, FixedProduct>:
  match a b:""")
print(f"    case {wide(A)} {wide(B)}:\n      wide_fixed_mul(p, {args(A+B)})")
print("""
def tc_div(p: U32, k: U32, a: RatioWord) -> Maybe<&2, DivProduct>:
  match a:""")
print(f"    case {wide(A)}:\n      small_fixed_div(p, 0, k, {args(A)})")
print("""
def tc_ratio(p: U32, a: RatioWord, b: RatioWord) -> Maybe<&2, RatioProduct>:
  match a b:""")
print(f"    case {wide(A)} {wide(B)}:\n      fixed_ratio(p, 0, 0, {args(A+B)})")
print("""
def tc_word_ok(a: RatioWord, ok: Bool) -> Maybe<&2, RatioWord>:
  match ok:
    case True{}:
      Some{a}
    case False{}:
      None{}

def tc_add_words(p: U32, a: RatioWord, b: RatioWord) -> Maybe<&2, RatioWord>:
  match a b:""")
print(f"    case {wide(A)} {wide(B)}:")
carry="0"
for i in range(8):
    print(f"      +s{i} = ratio_add(ratio_add(a{i}, b{i}), {carry})")
    print(f"      {'+' if i>=6 else ''}d{i} = U32.and(s{i}, 2047)")
    carry=f"c{i}"
    print(f"      {carry} = U32.shrn(s{i}, 11n)")
print(f"      ok = Bool.and(U32.is_eq({carry}, 0), ratio_cap(d6, d7, U32.is_eq(p, 44)))")
print(f"      tc_word_ok({wide([f'd{i}' for i in range(8)])}, ok)")
print("""
def tc_shift1(a: RatioWord) -> RatioWord:
  match a:""")
print(f"    case {wide([A[0]]+shared(A[1:]))}:")
print("      "+wide([f"U32.or(U32.shrn(a{i}, 1n), U32.shln(U32.and(a{i+1}, 1), 10n))"
                        for i in range(7)]+["U32.shrn(a7, 1n)"]))
print("""
def tc_lowbit(a: RatioWord) -> U32:
  match a:""")
print(f"    case {wide([A[0]]+['_']*7)}:\n      U32.and(a0, 1)")
print("""
def tc_fits24(a: RatioWord) -> Bool:
  match a:""")
print(f"    case {wide(['_','_']+A[2:])}:")
print(f"      Bool.and(U32.is_lt(a2, 4), U32.is_eq({uor(A[3:])}, 0))")
print("""
def tc_mantissa(a: RatioWord) -> U32:
  match a:""")
print(f"    case {wide(A[:3]+['_']*5)}:")
print("      U32.or(a0, U32.or(U32.shln(a1, 11n), U32.shln(a2, 22n)))")
print((p/"composition.bend.in").read_text())
