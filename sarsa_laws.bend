import Base
import ./agents/sarsa.bend as S
import ./tabular.bend as T
import ./engine.bend as E

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
