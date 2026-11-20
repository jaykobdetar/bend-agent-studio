import Base
import ./agent.bend as S
import ../../core/tabular.bend as T
import ../../core/engine.bend as E

law terminal_clears:
  for s: U32
  for p: S.Pending
  for q: T.Table
  for alpha: F32
  for gamma: F32
  {S.pending(S.accept(E.End{s},False{},p,q,alpha,gamma)) == S.Clear{} : S.Pending}

law truncation_clears:
  for s: U32
  for actions: List<&2,U32>
  for p: S.Pending
  for q: T.Table
  for alpha: F32
  for gamma: F32
  {S.pending(S.accept(E.Open{s,actions},True{},p,q,alpha,gamma)) == S.Clear{} : S.Pending}

law finish_clears:
  for m: S.Model
  for reason: E.Stop
  {S.pending(S.finish(m,reason)) == S.Clear{} : S.Pending}

law evaluation_is_first_max:
  for q: T.Table
  for pending: S.Pending
  for alpha: F32
  for gamma: F32
  for s: U32
  for legal: List<&2,U32>
  for word: U32
  {S.act(S.Agent{q,pending,alpha,gamma},s,legal,E.Evaluate{},word)
    == T.best_action(T.choices(legal,q,s)) : U32}
