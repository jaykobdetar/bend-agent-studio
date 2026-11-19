import Base
import ./agents/reinforce.bend as R
import ./core/engine.bend as E

law episode_buffer_empty:
  for m: R.Model
  for reason: E.Stop
  {R.history(R.finish(m,reason)) == [] : R.History}
