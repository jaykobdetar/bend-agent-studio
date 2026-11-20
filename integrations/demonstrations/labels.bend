import Base
import ../../core/tabular.bend as T
import ../../core/offline.bend as O
import ../../core/engine.bend as E

# Supervised targets have neither an environment reward nor a counterfactual
# transition. Count the supplied labels and reuse the standard Clone decision.
def empty() -> T.Table: []

def label(+counts: T.Table, +obs: U32, +action: U32) -> T.Table:
  +n = U32.add(T.visits(counts, obs, action), 1)
  T.store(counts, obs, action, T.Cell{n, U32.to_f32(n)})

def choose(counts: T.Table, obs: U32, legal: List<&2,U32>) -> U32:
  O.act(O.Policy{O.Clone{},[],counts}, obs, legal, E.Evaluate{}, 0)

def count(counts: T.Table, obs: U32, action: U32) -> U32:
  T.visits(counts, obs, action)
