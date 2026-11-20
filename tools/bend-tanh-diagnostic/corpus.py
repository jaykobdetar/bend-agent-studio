"""Recreate the two previously frozen U32 word generators, without a data dump."""
import hashlib
import sys

TINY = 0x39800000
LARGE = 0x41200000
INF = 0x7f800000
MAX = 0x7fffffff
SIGNS = (0, 0x80000000)

def next_xorshift(state):
    state ^= (state << 13) & 0xffffffff
    state ^= state >> 17
    state ^= (state << 5) & 0xffffffff
    return state

def encode(words):
    return "".join(f"{w:08x}\n" for w in words).encode("ascii")

# Initial JS fixture insertion order: magnitude, then positive and negative.
edges = (
    0, 1, 2, 0x003fffff, 0x007ffffe, 0x007fffff, 0x00800000, 0x00800001,
    TINY-2, TINY-1, TINY, TINY+1, TINY+2,
    0x3f800000, 0x41102cb3, 0x41102cb4,
    LARGE-2, LARGE-1, LARGE, LARGE+1, LARGE+2,
    INF-2, INF-1, INF, INF+1, 0x7f801234, 0x7fbfffff, 0x7fc00000,
    0x7fc01234, MAX,
)
out = dict.fromkeys(m | s for m in edges for s in SIGNS)
assert len(out) == 60
state = 0x9e3779b9
for lo, hi in ((1,TINY),(LARGE,INF-1),(INF+1,MAX)):
    for sign in SIGNS:
        added = 0
        while added < 256:
            state = next_xorshift(state)
            word = (lo + state % (hi-lo+1)) | sign
            if word not in out:
                out[word] = None
                added += 1
assert len(out) == 1596
assert hashlib.sha256(encode(out)).hexdigest() == "0e502fd153dfe5ccd740a8248c428afc4ed3fdbb3572e1db25d1b174e06551e6"
# A separately seeded reference-only extension, sorted by raw U32 value.
state = 0xb7e15162
for sign in SIGNS:
    added = 0
    while added < 2048:
        state = next_xorshift(state)
        word = sign | (TINY+1 + state % (LARGE-TINY-1))
        if word not in out:
            out[word] = None
            added += 1
assert len(out) == 5692
raw = encode(sorted(out))
assert hashlib.sha256(raw).hexdigest() == "a7215fc26468e629a0c072e9520faba7ffe32efec6d3236e8d493b995cc633d9"
sys.stdout.buffer.write(raw)
