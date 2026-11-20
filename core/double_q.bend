import Base
import ./engine.bend as E
import ./tabular.bend as T

# Each accepted training update consumes one private learner random word.
# The policy ranks legal actions by the sum of the two estimators.
type Tables is Data:
  Tables{left: T.Table, right: T.Table, seed: U32}

def choices(actions: List<&2, U32>, +left: T.Table, +right: T.Table, +obs: U32) -> T.Choices:
  match actions:
    case Nil{}: T.NoChoices{}
    case +a <> rest:
      q = F32.add(T.lookup(left, obs, a), T.lookup(right, obs, a))
      T.consider(a, q, choices(rest, left, right, obs))

def best(tables: Tables, obs: U32, actions: List<&2, U32>) -> U32:
  Tables{left, right, seed} = tables
  T.best_action(choices(actions, left, right, obs))

type CombinedScore is Data:
  CombinedScore{tables: Tables, obs: U32}

def combined_score(context: CombinedScore,+a: U32) -> F32:
  CombinedScore{tables,+obs}=context
  Tables{left,right,seed}=tables
  F32.add(T.lookup(left,obs,a),T.lookup(right,obs,a))

def sampled_best(tables: Tables,obs: U32,actions: List<&2,U32>,word: U32) -> U32:
  T.sampled_best(~CombinedScore,~(p => a => combined_score(p,a)),actions,CombinedScore{tables,obs},word)

def evaluate_best(right: T.Table, obs: U32, options: T.Choices) -> F32:
  match options:
    case T.NoChoices{}: 0.0
    case T.Choices{a, maximum, sum, count}: T.lookup(right, obs, a)

def continuation(left: T.Table, right: T.Table, view: E.View<U32>) -> F32:
  match view:
    case E.End{obs}: 0.0
    case E.Open{+obs, actions}:
      evaluate_best(right, obs, T.choices(actions, left, obs))

def adjust(+left: T.Table, right: T.Table, alpha: F32, gamma: F32, event: E.Transition<U32>) -> T.Table:
  E.Transition{obs, action, reward, next, truncated} = event
  target = F32.add(reward, F32.mul(gamma, continuation(left, right, next)))
  T.adjust(left, obs, action, T.Fixed{alpha}, target)

def update_side(left_side: Bool, +left: T.Table, +right: T.Table, seed: U32,
                alpha: F32, gamma: F32, event: E.Transition<U32>) -> Tables:
  match left_side:
    case True{}: Tables{adjust(left, right, alpha, gamma, event), right, seed}
    case False{}: Tables{left, adjust(right, left, alpha, gamma, event), seed}

def learn(tables: Tables, alpha: F32, gamma: F32, event: E.Transition<U32>) -> Tables:
  Tables{left, right, +seed} = tables
  side = U32.is_eq(U32.and(E.mix_word(seed), 1), 0)
  update_side(side, left, right, E.next_seed(seed), alpha, gamma, event)

def left(tables: Tables) -> T.Table:
  Tables{l, r, seed} = tables
  l

def right(tables: Tables) -> T.Table:
  Tables{l, r, seed} = tables
  r
