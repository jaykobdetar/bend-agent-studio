import Base
import ../engine.bend as E
import ../history.bend as H
import ../parameters.bend as P

# The clue is the first reward. Both hidden cases have the same public
# observation and legal action list at each decision.
type Hidden is Data:
  Cue{right: Bool}
  Guess{right: Bool}
  ClueFinished{}

def State() -> Data: H.State<Hidden,U32>
def Observation() -> Data: U32

def reset(seed: U32) -> Hidden:
  Cue{U32.is_ne(U32.and(E.mix_word(U32.xor(seed,104729)),1),0)}

def view(state: Hidden) -> E.View<U32>:
  match state:
    case Cue{right}: E.Open{0,[0]}
    case Guess{right}: E.Open{1,[1,2]}
    case ClueFinished{}: E.End{2}

def step(state: Hidden, action: U32, word: U32) -> Pair(Hidden,F32):
  match state:
    case Cue{+right}: (Guess{right},U32.to_f32(Bool.to_u32(right)))
    case Guess{right}: (ClueFinished{},Bool.pick(F32,U32.is_eq(action,Bool.pick(U32,right,2,1)),2.0,0.0))
    case ClueFinished{}: (ClueFinished{},0.0)

def remember(old: U32, before: U32, action: U32, reward: F32, after: U32) -> U32:
  Bool.to_u32(F32.is_gt(reward,0.0))

def plain(memory: U32, observation: U32) -> U32: observation

def with_reward(memory: U32, observation: U32) -> U32:
  U32.add(observation,U32.mul(3,memory))

def variant(enabled: Bool) -> E.World<State,Observation>:
  match enabled:
    case True{}: H.wrap(~Hidden,~U32,~U32,~U32,~reset,~view,~step,~0,~with_reward,~remember)
    case False{}: H.wrap(~Hidden,~U32,~U32,~U32,~reset,~view,~step,~0,~plain,~remember)

def world(p: P.Parameters) -> E.World<State,Observation>:
  variant(F32.is_gt(P.get(p,"memory",1.0),0.0))
