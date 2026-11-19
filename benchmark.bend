import Base
import ./core/engine.bend as E
import ./core/tabular.bend as T
import ./core/cliff.bend as Cliff
import ./core/doors.bend as Doors
import ./core/ferry.bend as Ferry
import ./core/key_maze.bend as Maze
import ./core/orchard.bend as Orchard

# Fixed before comparing learners. Each replicate gets a distinct block.
def training_episodes() -> Nat: 512n
def evaluation_episodes() -> Nat: 256n

def metrics(episodes: Nat, totals: E.Totals) -> String:
  E.Totals{+score, steps, terminal, limited, illegal} = totals
  F32.show(score) ++ "," ++ F32.show(F32.div(score, F32.from_nat(episodes))) ++ "," ++ Nat.show(steps) ++ "," ++
    Nat.show(terminal) ++ "," ++ Nat.show(limited) ++ "," ++ Nat.show(illegal)

def row(training: E.Totals, evaluation: Pair(T.Table, E.Totals)) -> String:
  (model, totals) = evaluation
  metrics(training_episodes(), training) ++ "," ++ metrics(evaluation_episodes(), totals)

def evaluate_result(~S: Data, ~hooks: E.Hooks<S, U32, T.Table>, seed: U32, limit: Nat,
                    training: Pair(T.Table, E.Totals)) -> String:
  (learned, train_totals) = training
  row(train_totals, E.run(~S, ~U32, ~T.Table, ~hooks, E.Evaluate{}, learned, seed, evaluation_episodes(), limit))

def trial(~S: Data, ~hooks: E.Hooks<S, U32, T.Table>, game: String, algorithm: String,
          +train_seed: U32, +eval_seed: U32, +limit: Nat) -> IO(Unit):
  trained = E.run(~S, ~U32, ~T.Table, ~hooks, E.Train{}, [], train_seed, training_episodes(), limit)
  result = evaluate_result(~S, ~hooks, eval_seed, limit, trained)
  IO.print(game ++ "," ++ algorithm ++ "," ++ U32.show(train_seed) ++ "," ++ U32.show(eval_seed) ++ "," ++ result)

def compare(~S: Data, ~world: E.World<S, U32>, +name: String, +limit: Nat,
            +train_seed: U32, +eval_seed: U32) -> IO(Unit):
  do IO<Unit>:
    trial(~S, ~E.Hooks{world, T.uniform, T.keep}, name, "random", train_seed, eval_seed, limit)
    trial(~S, ~E.Hooks{world, T.epsilon_greedy, T.bandit}, name, "sample_mean", train_seed, eval_seed, limit)
    trial(~S, ~E.Hooks{world, T.epsilon_greedy, T.q_learning}, name, "q_learning", train_seed, eval_seed, limit)
    trial(~S, ~E.Hooks{world, T.epsilon_greedy, T.expected_sarsa}, name, "expected_sarsa", train_seed, eval_seed, limit)

def replicate(+index: U32) -> IO(Unit):
  +train_seed = U32.add(10000, U32.mul(index, 10000))
  +eval_seed = U32.add(100000, U32.mul(index, 10000))
  do IO<Unit>:
    compare(~Doors.Hall, ~Doors.world(), "doors", 2n, train_seed, eval_seed)
    compare(~Bool, ~Orchard.world(), "orchard", 1n, train_seed, eval_seed)
    compare(~Ferry.Stage, ~Ferry.world(), "ferry", 3n, train_seed, eval_seed)
    compare(~Maze.State, ~Maze.world(), "key_maze", 12n, train_seed, eval_seed)
    compare(~U32, ~Cliff.world(), "cliff", 40n, train_seed, eval_seed)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("game,algorithm,train_seed,eval_seed,train_return,train_mean,train_steps,train_terminal,train_limited,train_illegal,eval_return,eval_mean,eval_steps,eval_terminal,eval_limited,eval_illegal")
    replicate(0)
    replicate(1)
    replicate(2)
    replicate(3)
    replicate(4)
