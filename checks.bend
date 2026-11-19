import Base
import ./core/engine.bend as E
import ./core/doors.bend as Doors
import ./core/history.bend as H
import ./main.bend as Demo
import ./bandit.bend as Bandit

# A second world with a different state, observation, action set and model.
# Each accepted action earns two points and consumes one tick.
def reset(seed: U32) -> Nat:
  U32.to_nat(seed)

def view(state: Nat) -> E.View<Nat>:
  match state:
    case 0n:
      E.End{0n}
    case 1n+rest:
      E.Open{1n+rest, [7]}

def step(state: Nat, action: U32, seed: U32) -> Pair(Nat, F32):
  match state:
    case 0n:
      (0n, 0.0)
    case 1n+rest:
      (rest, 2.0)

def legal(model: U32, obs: Nat, actions: List<&2, U32>, mode: E.Mode, seed: U32) -> U32:
  7

def reject_last(model: U32, obs: Nat, actions: List<&2, U32>, mode: E.Mode, seed: U32) -> U32:
  Bool.pick(U32, Nat.is_eq(obs, 1n), 99, 7)

# Encode which transitions the learner actually received into the model.
def learn(model: U32, event: E.Transition<Nat>) -> U32:
  match event:
    case E.Transition{obs, a, r, E.End{next}, False{}}:
      U32.add(model, 10)
    case E.Transition{obs, a, r, E.Open{next, acts}, True{}}:
      U32.add(model, 100)
    case E.Transition{obs, a, r, E.Open{next, acts}, False{}}:
      U32.add(model, 1)
    case _:
      999

def hooks() -> E.Hooks<Nat, Nat, U32>:
  E.Hooks{E.World{reset, view, step}, legal, learn}

def run(mode: E.Mode, turns: U32, limit: Nat) -> E.Report<U32>:
  E.episode(~Nat, ~Nat, ~U32, ~hooks(), mode, 0, turns, limit)

# Replay a seeded policy in the same two-door world with the original learner.
def seeded_action(model: Bandit.Model, obs: U32, actions: List<&2, U32>,
                 mode: E.Mode, word: U32) -> U32:
  U32.and(U32.shrn(word, 13n), 1)

def replay(seed: U32) -> F32:
  Demo.score(E.run(~Doors.Hall, ~U32, ~Bandit.Model, ~E.Hooks{Doors.world(), seeded_action, Bandit.learn},
                   E.Evaluate{}, Bandit.initial(), seed, 1n, 2n))

def same_stop(a: E.Stop, b: E.Stop) -> Bool:
  match a b:
    case E.Terminal{} E.Terminal{}:
      True{}
    case E.Limit{} E.Limit{}:
      True{}
    case E.Illegal{x} E.Illegal{y}:
      U32.is_eq(x, y)
    case _ _:
      False{}

def report_is(got: E.Report<U32>, model: U32, score: F32, steps: Nat, reason: E.Stop) -> Bool:
  E.Report{m, s, n, r} = got
  U32.is_eq(m, model) && F32.is_eq(s, score) && Nat.is_eq(n, steps) && same_stop(r, reason)

def totals_are(got: Pair(U32, E.Totals), model: U32, score: F32, steps: Nat,
              terminal: Nat, limited: Nat, illegal: Nat) -> Bool:
  (m, E.Totals{s, n, t, l, i}) = got
  U32.is_eq(m, model) && F32.is_eq(s, score) && Nat.is_eq(n, steps) &&
    Nat.is_eq(t, terminal) && Nat.is_eq(l, limited) && Nat.is_eq(i, illegal)

# Use the adapter's actual start and step callbacks. A prior episode advances
# its public memory; the next reset has the new world seed and the original memory.
def fresh_after_step(prior: Pair(H.State<Nat,U32>, F32), fresh: H.State<Nat,U32>) -> Bool:
  (H.Remembered{first_state, advanced_memory}, reward) = prior
  H.Remembered{next_state, fresh_memory} = fresh
  Nat.is_eq(first_state, 3n) && U32.is_eq(advanced_memory, 42) &&
    Nat.is_eq(next_state, 9n) && U32.is_eq(fresh_memory, 41)

def advanced_history(world: E.World<H.State<Nat,U32>,U32>) -> Pair(H.State<Nat,U32>, F32):
  E.World{start, show, move} = world
  move(start(4), 7, 0)

def new_history(world: E.World<H.State<Nat,U32>,U32>) -> H.State<Nat,U32>:
  E.World{start, show, move} = world
  start(9)

def wrapped_resets(~world: E.World<H.State<Nat,U32>,U32>) -> Bool:
  fresh_after_step(advanced_history(world), new_history(world))

def counting_history() -> E.World<H.State<Nat,U32>,U32>:
  H.wrap(~Nat, ~Nat, ~U32, ~U32, ~reset, ~view, ~step, ~41,
    ~(h => o => h), ~(h => o => a => r => next => U32.add(h, 1)))

def check(label: String, ok: Bool) -> IO(Unit):
  match ok:
    case True{}:
      IO.print("pass - " ++ label)
    case False{}:
      IO.die(Unit, 1, "failed - " ++ label)

def main() -> IO(Unit):
  rejected = E.episode(~Nat, ~Nat, ~U32, ~E.Hooks{E.World{reset, view, step}, reject_last, learn},
                       E.Train{}, 0, 2, 5n)
  illegal_batch = E.run(~Nat, ~Nat, ~U32, ~E.Hooks{E.World{reset, view, step}, reject_last, learn},
                        E.Train{}, 0, 1, 1n, 5n)
  empty = E.run(~Nat, ~Nat, ~U32, ~hooks(), E.Train{}, 42, 5, 0n, 4n)
  batch = E.run(~Nat, ~Nat, ~U32, ~hooks(), E.Train{}, 0, 0, 3n, 1n)
  before = Demo.score(Demo.evaluate(Bandit.initial()))
  after = Demo.after_training(Demo.train(Bandit.initial()))
  do IO<Unit>:
    check("history wrapper resets world seed and episode memory", wrapped_resets(~counting_history()))
    check("terminal at reset", report_is(run(E.Train{}, 0, 4n), 0, 0.0, 0n, E.Terminal{}))
    check("zero step limit", report_is(run(E.Train{}, 2, 0n), 0, 0.0, 0n, E.Limit{}))
    check("terminal at reset with zero fuel", report_is(run(E.Train{}, 0, 0n), 0, 0.0, 0n, E.Terminal{}))
    check("terminal on the last allowed step", report_is(run(E.Train{}, 2, 2n), 11, 4.0, 2n, E.Terminal{}))
    check("truncation reaches the learner", report_is(run(E.Train{}, 2, 1n), 100, 2.0, 1n, E.Limit{}))
    check("illegal action preserves earlier progress", report_is(rejected, 1, 2.0, 1n, E.Illegal{99}))
    check("evaluation freezes the model", report_is(run(E.Evaluate{}, 2, 2n), 0, 4.0, 2n, E.Terminal{}))
    check("empty batch preserves model", totals_are(empty, 42, 0.0, 0n, 0n, 0n, 0n))
    check("batch carries learning and counts exits", totals_are(batch, 110, 4.0, 2n, 2n, 1n, 0n))
    check("batch counts a rejected first action", totals_are(illegal_batch, 0, 0.0, 0n, 0n, 0n, 1n))
    check("seeded replay", F32.is_eq(replay(44), 0.0) && F32.is_eq(replay(45), 2.0) && F32.is_eq(replay(44), 0.0))
    check("two-door learning on held-out seeds", F32.is_eq(before, 8.0) && F32.is_eq(after, 16.0))
