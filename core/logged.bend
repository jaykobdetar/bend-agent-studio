import Base
import ./engine.bend as E
import ./tabular.bend as T

# One public 16-bit draw chooses between a preferred action and round-robin
# exploration. The number of buckets assigned to every action is exact.
def choose(+actions: List<&2,U32>, preferred: U32, buckets: U32, word: U32) -> U32:
  +draw=U32.and(word,65535)
  Bool.pick(U32,U32.is_lt(draw,buckets),T.random_action(actions,draw),preferred)

def count(index: U32, count: U32, +buckets: U32, preferred: Bool) -> U32:
  +size=U32.max(1,count)
  exploration=U32.add(U32.div(buckets,size),Bool.to_u32(U32.is_lt(index,U32.mod(buckets,size))))
  U32.add(exploration,Bool.pick(U32,preferred,U32.sub(65536,buckets),0))

def base(~O: Data, ~M: Data, ~act: M -> O -> List<&2,U32> -> E.Mode -> U32 -> U32,
         model: M, obs: O, actions: List<&2,U32>) -> U32:
  act(model,obs,actions,E.Evaluate{},0)

type Behavior<-M: Data> is Data:
  Behavior{frozen: M, buckets: U32}

def policy(~O: Data, ~M: Data, ~act: M -> O -> List<&2,U32> -> E.Mode -> U32 -> U32,
           source: Behavior<M>, obs: O, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  Behavior{model,buckets}=source
  +legal=actions
  choose(legal,base(~O,~M,~act,model,obs,legal),buckets,word)

def rollout(~S: Data, ~O: Data, ~M: Data, ~world: E.World<S,O>,
            ~act: M -> O -> List<&2,U32> -> E.Mode -> U32 -> U32,
            model: M, seed: U32, limit: Nat, buckets: U32) -> E.Observed<List<&2,E.Frame<O>>,Behavior<M>>:
  E.trace(~S,~O,~Behavior<M>,~E.Hooks{world,policy(~O,~M,~act),m => event => m},
          E.Evaluate{},Behavior{model,buckets},seed,limit)
