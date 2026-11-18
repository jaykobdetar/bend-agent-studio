import Base
import ./engine.bend as E

# A sparse table keyed by the actual observation and action IDs.
type Entry is Data:
  Entry{observation: U32, action: U32, visits: U32, value: F32}

def Table() -> Data:
  List<&2, Entry>

def lookup(table: Table, +obs: U32, +action: U32) -> F32:
  match table:
    case Nil{}: 0.0
    case Entry{s, a, visits, value} <> rest:
      Bool.pick(F32, U32.is_eq(s, obs) && U32.is_eq(a, action), value, lookup(rest, obs, action))

def visits(table: Table, +obs: U32, +action: U32) -> U32:
  match table:
    case Nil{}: 0
    case Entry{s,a,n,v} <> rest:
      Bool.pick(U32,U32.is_eq(s,obs) && U32.is_eq(a,action),n,visits(rest,obs,action))

type Rate is Data:
  SampleMean{}
  Constant{}
  Fixed{alpha: F32}

def rate(rule: Rate, visits: U32) -> F32:
  match rule:
    case SampleMean{}: F32.div(1.0, U32.to_f32(visits))
    case Constant{}: 0.25
    case Fixed{alpha}: alpha

def revised(rule: Rate, obs: U32, action: U32, +visits: U32, +old: F32, target: F32) -> Entry:
  value = F32.add(old, F32.mul(rate(rule, visits), F32.sub(target, old)))
  Entry{obs, action, visits, value}

def replace_or_keep(found: Bool, replacement: Unit -> Table, keep_searching: Unit -> Table) -> Table:
  match found:
    case True{}: replacement(Unit{})
    case False{}: keep_searching(Unit{})

def adjust(table: Table, +obs: U32, +action: U32, +rule: Rate, +target: F32) -> Table:
  match table:
    case Nil{}:
      [revised(rule, obs, action, 1, 0.0, target)]
    case Entry{+s, +a, +visits, +old} <> +rest:
      found = U32.is_eq(s, obs) && U32.is_eq(a, action)
      replace_or_keep(found,
        u => revised(rule, s, a, U32.add(visits, 1), old, target) <> rest,
        u => Entry{s, a, visits, old} <> adjust(rest, obs, action, rule, target))

type Choices is Data:
  NoChoices{}
  Choices{best: U32, maximum: F32, sum: F32, count: U32}

def consider(+action: U32, +value: F32, tail: Choices) -> Choices:
  match tail:
    case NoChoices{}: Choices{action, value, value, 1}
    case Choices{best, +maximum, sum, count}:
      +first = F32.is_ge(value, maximum)
      Choices{Bool.pick(U32, first, action, best), Bool.pick(F32, first, value, maximum),
              F32.add(value, sum), U32.add(1, count)}

def choices(actions: List<&2, U32>, +table: Table, +obs: U32) -> Choices:
  match actions:
    case Nil{}: NoChoices{}
    case +action <> rest:
      consider(action, lookup(table, obs, action), choices(rest, table, obs))

def best_action(options: Choices) -> U32:
  match options:
    case NoChoices{}: 0
    case Choices{best, maximum, sum, count}: best

def selected(action: Maybe<&2, U32>) -> U32:
  match action:
    case None{}: 0
    case Some{a}: a

def random_action(+actions: List<&2, U32>, word: U32) -> U32:
  count = U32.from_nat(List.length(&2, U32, actions))
  index = U32.mod(word, U32.max(1, count))
  selected(List.get(&2, U32, actions, U32.to_nat(index)))

def exploratory(mode: E.Mode, word: U32) -> Bool:
  match mode:
    case E.Evaluate{}: False{}
    case E.Train{}: U32.is_eq(U32.and(word, 3), 0)

def choose(explore: Bool, model: Table, obs: U32, actions: List<&2, U32>, word: U32) -> U32:
  match explore:
    case True{}: random_action(actions, U32.shrn(word, 2n))
    case False{}: best_action(choices(actions, model, obs))

def epsilon_greedy(model: Table, obs: U32, actions: List<&2, U32>, mode: E.Mode, word: U32) -> U32:
  +bits = word
  choose(exploratory(mode, bits), model, obs, actions, bits)

def uniform(model: Table, obs: U32, actions: List<&2, U32>, mode: E.Mode, word: U32) -> U32:
  random_action(actions, word)

def keep(model: Table, event: E.Transition<U32>) -> Table:
  model

def bandit(model: Table, event: E.Transition<U32>) -> Table:
  E.Transition{obs, action, reward, next, truncated} = event
  adjust(model, obs, action, SampleMean{}, reward)

type Backup is Data:
  Greedy{}
  Expected{}

def option_value(backup: Backup, options: Choices) -> F32:
  match backup options:
    case _ NoChoices{}: 0.0
    case Greedy{} Choices{a, maximum, sum, count}: maximum
    case Expected{} Choices{a, maximum, sum, count}:
      # The training policy exploits with probability 3/4. Its exploratory
      # quarter is spread across every legal action, including the best.
      average = F32.div(sum, U32.to_f32(count))
      F32.add(F32.mul(0.75, maximum), F32.mul(0.25, average))

def bootstrap(backup: Backup, model: Table, next: E.View<U32>) -> F32:
  match next:
    case E.End{obs}: 0.0
    case E.Open{obs, actions}: option_value(backup, choices(actions, model, obs))

def td(backup: Backup, +model: Table, event: E.Transition<U32>) -> Table:
  E.Transition{obs, action, reward, next, truncated} = event
  # A time-limited open state still has a continuation value.
  target = F32.add(reward, F32.mul(0.9, bootstrap(backup, model, next)))
  adjust(model, obs, action, Constant{}, target)

def q_learning(model: Table, event: E.Transition<U32>) -> Table:
  td(Greedy{}, model, event)

def expected_sarsa(model: Table, event: E.Transition<U32>) -> Table:
  td(Expected{}, model, event)
