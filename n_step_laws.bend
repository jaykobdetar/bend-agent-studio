import Base
import ./agents/n_step.bend as N
import ./tabular.bend as T
import ./engine.bend as E

law terminal_flush:
  for s: U32
  for b: N.Buffer
  for q: T.Table
  for n: U32
  for a: F32
  for g: F32
  {N.accept(E.End{s},False{},b,q,N.Config{n,a,g}) == N.Agent{N.flush(b,q,a,g,0.0),[],N.Config{n,a,g}} : N.Model}

law truncated_empty:
  for s: U32
  for xs: List<&2,U32>
  for b: N.Buffer
  for q: T.Table
  for n: U32
  for a: F32
  for g: F32
  {N.buffer(N.accept(E.Open{s,xs},True{},b,q,N.Config{n,a,g})) == [] : N.Buffer}

law finish_empty:
  for m: N.Model
  for reason: E.Stop
  {N.buffer(N.finish(m,reason)) == [] : N.Buffer}
