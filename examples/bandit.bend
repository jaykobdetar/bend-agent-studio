import Base
import ../core/engine.bend as E

# Estimated rewards for actions 0 and 1 under each of two observations.
type Row is Data:
  Row{left: F32, right: F32}

type Model is Data:
  Table{dark: Row, lit: Row}

def initial() -> Model:
  Table{Row{0.0, 0.0}, Row{0.0, 0.0}}

def greedy(row: Row) -> U32:
  Row{left, right} = row
  Bool.to_u32(F32.is_gt(right, left))

def preference(model: Model, obs: U32) -> U32:
  Table{dark, lit} = model
  greedy(Bool.pick(Row, U32.is_eq(obs, 0), dark, lit))

# On a training turn, explore with probability 1/2 using two bits of the seed.
def explore(mode: E.Mode, best: U32, +seed: U32) -> U32:
  match mode:
    case E.Evaluate{}:
      best
    case E.Train{}:
      explore_bit = U32.and(seed, 8192)
      random_action = U32.and(U32.shrn(seed, 16n), 1)
      Bool.pick(U32, U32.is_eq(explore_bit, 0), best, random_action)

def first_or_zero(actions: List<&2, U32>) -> U32:
  match actions:
    case Nil{}:
      0
    case h <> t:
      h

def act(model: Model, obs: U32, actions: List<&2, U32>, mode: E.Mode, seed: U32) -> U32:
  +available = actions
  +preferred = explore(mode, preference(model, obs), seed)
  legal = List.contains(~U32, ~U32.is_eq, available, preferred)
  Bool.pick(U32, legal, preferred, first_or_zero(available))

# A constant-step-size bandit update Q <- Q + 0.5 * (reward - Q).
def estimate(+old: F32, reward: F32) -> F32:
  F32.add(old, F32.mul(0.5, F32.sub(reward, old)))

def update_row(row: Row, action: U32, reward: F32) -> Row:
  match row action:
    case Row{left, right} 0:
      Row{estimate(left, reward), right}
    case Row{left, right} _:
      Row{left, estimate(right, reward)}

def learn(model: Model, transition: E.Transition<U32>) -> Model:
  match model transition:
    case Table{dark, lit} E.Transition{0, action, reward, next, truncated}:
      Table{update_row(dark, action, reward), lit}
    case Table{dark, lit} E.Transition{obs, action, reward, next, truncated}:
      Table{dark, update_row(lit, action, reward)}
