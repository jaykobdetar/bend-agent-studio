import Base
import ../core/engine.bend as E
import ../core/tabular.bend as T
import ./checks.bend as Tests
import ../core/cliff.bend as Cliff
import ../core/ferry.bend as Ferry
import ../core/key_maze.bend as Maze
import ../core/orchard.bend as Orchard

# Both actions receive exactly the same reward function, a coin toss.
type CoinCounts is Data:
  CoinCounts{left: U32, left_wins: U32, right: U32, right_wins: U32}

def coin_view(done: Bool) -> E.View<U32>:
  match done:
    case True{}: E.End{0}
    case False{}: E.Open{0, [0, 1]}

def coin_step(done: Bool, action: U32, word: U32) -> Pair(Bool, F32):
  (True{}, U32.to_f32(U32.and(word, 1)))

def coin_act(model: CoinCounts, obs: U32, actions: List<&2, U32>, mode: E.Mode, word: U32) -> U32:
  U32.and(word, 1)

def count_coin(model: CoinCounts, event: E.Transition<U32>) -> CoinCounts:
  match model event:
    case CoinCounts{l, lw, r, rw} E.Transition{o, 0, reward, next, cut}:
      CoinCounts{U32.add(l, 1), U32.add(lw, Bool.to_u32(F32.is_eq(reward, 1.0))), r, rw}
    case CoinCounts{l, lw, r, rw} E.Transition{o, a, reward, next, cut}:
      CoinCounts{l, lw, U32.add(r, 1), U32.add(rw, Bool.to_u32(F32.is_eq(reward, 1.0)))}

def coin_hooks() -> E.Hooks<Bool, U32, CoinCounts>:
  E.Hooks{E.World{Orchard.reset, coin_view, coin_step}, coin_act, count_coin}

def raw_coins(episodes: Nat, +seed: U32, counts: CoinCounts) -> CoinCounts:
  match episodes:
    case 0n: counts
    case 1n+rest:
      result = E.episode_raw(~Bool, ~U32, ~CoinCounts, ~coin_hooks(), E.Train{}, counts, seed, 1n)
      raw_coins(rest, U32.add(seed, 1), E.get_model(CoinCounts, result))

def old_coin_counts(counts: CoinCounts) -> Bool:
  CoinCounts{l, lw, r, rw} = counts
  U32.is_eq(l, 512) && U32.is_eq(lw, 512) && U32.is_eq(r, 512) && U32.is_eq(rw, 0)

def balanced(+count: U32, +wins: U32) -> Bool:
  # Each arm must be sampled frequently, and win between 40% and 60%.
  U32.is_gt(count, 400) && U32.is_ge(U32.mul(wins, 5), U32.mul(count, 2)) &&
    U32.is_le(U32.mul(wins, 5), U32.mul(count, 3))

def new_coin_counts(result: Pair(CoinCounts, E.Totals)) -> Bool:
  (CoinCounts{l, lw, r, rw}, totals) = result
  balanced(l, lw) && balanced(r, rw)

def close(+x: F32, +expected: F32) -> Bool:
  F32.is_lt(F32.abs(F32.sub(x, expected)), 0.00001)

def td_fixture() -> T.Table:
  [T.Entry{1, 7, 1, 4.0}, T.Entry{1, 8, 1, 0.0}, T.Entry{1, 99, 1, 100.0}]

def continuing(cut: Bool) -> E.Transition<U32>:
  E.Transition{0, 17, 1.0, E.Open{1, [7, 8]}, cut}

def value(table: T.Table) -> F32:
  T.lookup(table, 0, 17)

def bandit_updates() -> T.Table:
  first = T.bandit([], E.Transition{7, 42, 1.0, E.End{9}, False{}})
  second = T.bandit(first, E.Transition{7, 42, 0.0, E.End{9}, False{}})
  T.bandit(second, E.Transition{7, 17, 0.75, E.End{9}, False{}})

def orchard_pays(result: Pair(Bool, F32), expected: F32) -> Bool:
  (done, reward) = result
  done && F32.is_eq(reward, expected)

def cliff_fall(result: Pair(U32, F32)) -> Bool:
  (cell, reward) = result
  U32.is_eq(cell, 10) && F32.is_eq(reward, F32.sub(0.0, 100.0))

def can_unlock(view: E.View<U32>) -> Bool:
  match view:
    case E.End{obs}: False{}
    case E.Open{obs, actions}: List.contains(~U32, ~U32.is_eq, actions, 20)

def episode_score(report: E.Report<T.Table>) -> F32:
  E.Report{model, score, steps, stop} = report
  score

def evaluate_learned(~S: Data, ~hooks: E.Hooks<S, U32, T.Table>, limit: Nat,
                    result: Pair(T.Table, E.Totals)) -> F32:
  (model, train_totals) = result
  episode_score(E.episode(~S, ~U32, ~T.Table, ~hooks, E.Evaluate{}, model, 100000, limit))

def learned_score(~S: Data, ~hooks: E.Hooks<S, U32, T.Table>, +limit: Nat) -> F32:
  trained = E.run(~S, ~U32, ~T.Table, ~hooks, E.Train{}, [], 10000, 512n, limit)
  evaluate_learned(~S, ~hooks, limit, trained)

def main() -> IO(Unit):
  raw = raw_coins(1024n, 0, CoinCounts{0, 0, 0, 0})
  mixed = E.run(~Bool, ~U32, ~CoinCounts, ~coin_hooks(), E.Train{}, CoinCounts{0, 0, 0, 0}, 0, 1024n, 1n)
  +bandit = bandit_updates()
  negative = {[T.Entry{1, 7, 1, F32.sub(0.0, 4.0)}, T.Entry{1, 8, 1, F32.sub(0.0, 2.0)},
               T.Entry{1, 99, 1, 100.0}] : T.Table}
  terminal = {E.Transition{0, 17, 2.0, E.End{1}, False{}} : E.Transition<U32>}
  do IO<Unit>:
    Tests.check("legacy replay reproduces the correlated coin", old_coin_counts(raw))
    Tests.check("mixed policy and world coins are balanced on both arms", new_coin_counts(mixed))
    Tests.check("sample mean uses visits for each observation/action pair",
      close(T.lookup(bandit, 7, 42), 0.5) && close(T.lookup(bandit, 7, 17), 0.75) && close(T.lookup(bandit, 0, 42), 0.0))
    Tests.check("greedy compares negative legal values and excludes an illegal high value",
      U32.is_eq(T.epsilon_greedy(negative, 1, [7, 8], E.Evaluate{}, 0), 8))
    Tests.check("Q-learning uses the best legal continuation",
      close(value(T.q_learning(td_fixture(), continuing(False{}))), 1.15))
    Tests.check("Expected SARSA weights the actual training policy",
      close(value(T.expected_sarsa(td_fixture(), continuing(False{}))), 1.0375))
    Tests.check("time limits keep the continuation value",
      close(value(T.q_learning(td_fixture(), continuing(True{}))), 1.15))
    Tests.check("terminal updates use only the final reward", close(value(T.q_learning(td_fixture(), terminal)), 0.5))
    Tests.check("orchard thresholds share the same environmental draw",
      orchard_pays(Orchard.step(False{}, 17, 2), 0.0) && orchard_pays(Orchard.step(False{}, 42, 2), 1.0))
    Tests.check("key controls vault access",
      Bool.not(can_unlock(Maze.view(Maze.Cell{1, False{}}))) && can_unlock(Maze.view(Maze.Cell{1, True{}})))
    Tests.check("a cliff fall returns to the entrance with its penalty", cliff_fall(Cliff.step(6, 40, 0)))
    Tests.check("bandit learns the immediate delivery", close(
      learned_score(~Ferry.Stage, ~E.Hooks{Ferry.world(), T.epsilon_greedy, T.bandit}, 3n), 1.0))
    Tests.check("Q-learning learns the five-action key route", close(
      learned_score(~Maze.State, ~E.Hooks{Maze.world(), T.epsilon_greedy, T.q_learning}, 12n), 4.0))
    Tests.check("Q-learning learns the short cliff route", close(
      learned_score(~U32, ~E.Hooks{Cliff.world(), T.epsilon_greedy, T.q_learning}, 40n), F32.sub(0.0, 6.0)))
    Tests.check("Expected SARSA learns the longer cliff route", close(
      learned_score(~U32, ~E.Hooks{Cliff.world(), T.epsilon_greedy, T.expected_sarsa}, 40n), F32.sub(0.0, 8.0)))
