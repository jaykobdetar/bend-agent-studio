import Base
import ./engine.bend as E
import ./cursor.bend as C

# Reset exposes two fixture coordinates from the seed. The low byte is
# position; the next two bytes are the terminal and illegal positions.
def reset(seed: U32) -> U32: U32.and(seed,16776960)

def inspect_at(hit: Bool,state: U32) -> E.View<U32>:
  match hit:
    case True{}: E.End{state}
    case False{}: E.Open{state,[2,7]}

def inspect(+state: U32) -> E.View<U32>:
  inspect_at(U32.is_eq(U32.and(state,255),U32.and(U32.div(state,256),255)),state)

def step(state: U32, action: U32, word: U32) -> Pair(U32,F32):
  (U32.add(state,1),Bool.pick(F32,U32.is_eq(action,2),F32.sub(0.0,0.5),0.75))

def policy_at(hit: Bool,word: U32) -> U32:
  match hit:
    case True{}: 99
    case False{}: Bool.pick(U32,U32.is_eq(U32.and(word,1),0),2,7)

def policy(model: U32, +state: U32, actions: List<&2,U32>, mode: E.Mode, word: U32) -> U32:
  policy_at(U32.is_eq(U32.and(state,255),U32.and(U32.div(state,65536),255)),word)

def learn(model: U32, event: E.Transition<U32>) -> U32:
  E.Transition{obs,action,reward,view,truncated} = event
  U32.add(model,U32.add(action,Bool.to_u32(truncated)))

def context_learn(model: U32, actions: List<&2,U32>, event: E.Transition<U32>) -> U32:
  match actions:
    case first<>rest: U32.add(learn(model,event),first)
    case []: model

def finish(model: U32, reason: E.Stop) -> U32:
  match reason:
    case E.Terminal{}: U32.add(model,100)
    case E.Limit{}: U32.add(model,200)
    case E.Illegal{action}: U32.add(model,300)

def cursor(segment: C.Segment<U32,U32,U32>) -> C.Cursor<U32,U32,U32>:
  match segment:
    case C.Segment{c,m,n,r,done}: c

def report(segment: C.Segment<U32,U32,U32>) -> Maybe<&2,E.Report<U32>>:
  match segment:
    case C.Segment{c,m,n,r,done}: done

def coordinate(~hooks: E.Hooks<U32,U32,U32>,+mode: E.Mode,+seed: U32,+limit: Nat,
               first: Nat,second: Nat) -> Pair(Maybe<&2,E.Report<U32>>,E.Report<U32>):
  partial = C.segment(~U32,~U32,~U32,~hooks,mode,first,C.start(~U32,~U32,~U32,~hooks,13,seed,limit))
  complete = C.segment(~U32,~U32,~U32,~hooks,mode,second,cursor(partial))
  (report(complete),E.episode(~U32,~U32,~U32,~hooks,mode,13,seed,limit))

def finishing(mode: E.Mode,seed: U32,limit: Nat,
              first: Nat,second: Nat) -> Pair(Maybe<&2,E.Report<U32>>,E.Report<U32>):
  coordinate(~E.Finishing{E.World{reset,s => inspect(s),step},m => s => actions => mode => word => policy(m,s,actions,mode,word),learn,finish},mode,seed,limit,first,second)

def contextual(mode: E.Mode,seed: U32,limit: Nat,
                first: Nat,second: Nat) -> Pair(Maybe<&2,E.Report<U32>>,E.Report<U32>):
  coordinate(~E.Contextual{E.World{reset,s => inspect(s),step},m => s => actions => mode => word => policy(m,s,actions,mode,word),context_learn,finish},mode,seed,limit,first,second)
