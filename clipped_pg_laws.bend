import Base
import ./core/engine.bend as E
import ./agents/clipped_pg.bend as P

law evaluating_preserves_policy_and_pending_batch:
  for m: P.Model
  for reason: E.Stop
  {E.finish_model(P.Model,P.finish,E.Evaluate{},m,reason) == m : P.Model}
