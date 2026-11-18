import Base
import ./engine.bend as E
import ./study.bend as Study
import ./double_q.bend as DQ
import ./weights.bend as W
import ./history.bend as H
import ./cursor.bend as C
import ./dyna.bend as Dyna
import ./tile_control.bend as Tile
import ./mountain_car.bend as Car
import ./tabular.bend as T
import ./actor_critic.bend as AC
import ./cartpole.bend as Pole
import ./offline.bend as Offline
import ./arena.bend as Arena
import ./arena_table.bend as ArenaTable
import ./agents/self_play.bend as Player

law evaluation_freezes_model:
  for -M: Data
  for -O: Data
  for learn: M -> E.Transition<O> -> M
  for model: M
  for event: E.Transition<O>
  {E.update(M, O, learn, E.Evaluate{}, model, event) == model : M}

law training_uses_one_update:
  for -M: Data
  for -O: Data
  for learn: M -> E.Transition<O> -> M
  for model: M
  for event: E.Transition<O>
  {E.update(M, O, learn, E.Train{}, model, event) == learn(model, event) : M}

law rejection_preserves_progress:
  for -S: Data
  for -O: Data
  for -M: Data
  for hooks: E.Hooks<S, O, M>
  for mode: E.Mode
  for remaining: Nat
  for state: S
  for observation: O
  for model: M
  for action: U32
  for seed: U32
  for score: F32
  for steps: Nat
  {E.accept(S, O, M, hooks, False{}, mode, remaining, state, observation, model, action, seed, score, steps)
    == E.Stopped{E.Report{model, score, steps, E.Illegal{action}}} : E.Run<S, O, M>}

law terminal_view_stops:
  for -S: Data
  for -O: Data
  for -M: Data
  for state: S
  for model: M
  for seed: U32
  for score: F32
  for steps: Nat
  for observation: O
  {E.place(S, O, M, state, model, seed, score, steps, E.End{observation})
    == E.Stopped{E.Report{model, score, steps, E.Terminal{}}} : E.Run<S, O, M>}

law open_at_limit_is_truncated:
  for -O: Data
  for obs: O
  for actions: List<&2, U32>
  {E.truncated(O, 0n, E.Open{obs, actions}) == True{} : Bool}

law terminal_is_never_truncated:
  for -O: Data
  for remaining: Nat
  for obs: O
  {E.truncated(O, remaining, E.End{obs}) == False{} : Bool}

# Averages and completion rates use this denominator, including failed episodes.
law every_report_counts_once:
  for totals: E.Totals
  for score: F32
  for steps: Nat
  for reason: E.Stop
  {E.episode_count(E.count(totals, score, steps, reason)) == 1n+E.episode_count(totals) : Nat}

law terminal_has_no_continuation:
  for method: Study.Method
  for exploration: U32
  for values: T.Table
  for obs: U32
  {Study.continuation(method, exploration, values, E.End{obs}) == 0.0 : F32}

law evaluation_disables_exploration:
  for exploration: U32
  for word: U32
  {Study.explores(E.Evaluate{}, exploration, word) == False{} : Bool}

law double_q_left_preserves_right:
  for left: T.Table
  for right: T.Table
  for seed: U32
  for alpha: F32
  for gamma: F32
  for event: E.Transition<U32>
  {DQ.right(DQ.update_side(True{}, left, right, seed, alpha, gamma, event)) == right : T.Table}

law double_q_right_preserves_left:
  for left: T.Table
  for right: T.Table
  for seed: U32
  for alpha: F32
  for gamma: F32
  for event: E.Transition<U32>
  {DQ.left(DQ.update_side(False{}, left, right, seed, alpha, gamma, event)) == left : T.Table}

# An arbitrary-length feature address retrieves exactly the row just written.
law weight_read_after_write:
  for at: W.Path
  for tree: W.Tree
  for row: W.Row
  {W.read(at, W.put(at, tree, row)) == row : W.Row}

law low_write_preserves_high:
  for suffix: W.Path
  for tree: W.Tree
  for row: W.Row
  {W.high(W.put(W.Low{suffix}, tree, row)) == W.high(tree) : W.Tree}

law high_write_preserves_low:
  for suffix: W.Path
  for tree: W.Tree
  for row: W.Row
  {W.low(W.put(W.High{suffix}, tree, row)) == W.low(tree) : W.Tree}

law tile_terminal_has_no_continuation:
  for method: Tile.Method
  for buckets: U32
  for tree: W.Tree
  for state: Car.State
  {Tile.future(method, buckets, tree, E.End{state}) == 0.0 : F32}

law history_preserves_legal_actions:
  for -O: Data
  for -Hid: Data
  for -F: Data
  for encode: Hid -> O -> F
  for h: Hid
  for obs: O
  for legal: List<&2, U32>
  {H.encode_view(O, Hid, F, encode, h, E.Open{obs, legal}) == E.Open{encode(h, obs), legal} : E.View<F>}

law history_preserves_reward:
  for -S: Data
  for -O: Data
  for -Hid: Data
  for show: S -> E.View<O>
  for remember: Hid -> O -> U32 -> F32 -> O -> Hid
  for h: Hid
  for obs: O
  for action: U32
  for next: S
  for reward: F32
  {Pair.snd(H.State<S,Hid>, F32, H.moved(S, O, Hid, show, remember, h, obs, action, (next,reward))) == reward : F32}

# Generic observer and split-budget laws additionally cover authored finite,
# Cliff and continuous-observation CartPole worlds without world-specific proofs.
law observer_preserves_report:
  for ~S: Data
  for ~O: Data
  for ~M: Data
  for ~hooks: E.Hooks<S,O,M>
  for ~A: Data
  for ~observe: A -> O -> List<&2,U32> -> U32 -> Maybe<&2,E.Transition<O>> -> A
  for fuel: Nat
  for mode: E.Mode
  for run: E.Run<S,O,M>
  for record: A
  {E.report_of(A,M,E.drive(~S,~O,~M,~hooks,~A,~observe,fuel,mode,run,record))
    == E.roll(~S,~O,~M,~hooks,fuel,mode,run) : E.Report<M>}

law pause_composes:
  for ~S: Data
  for ~O: Data
  for ~M: Data
  for ~hooks: E.Hooks<S,O,M>
  for first: Nat
  for second: Nat
  for mode: E.Mode
  for cursor: C.Cursor<S,O,M>
  {C.advance(~S,~O,~M,~hooks,Nat.add(first,second),mode,cursor)
    == C.advance(~S,~O,~M,~hooks,second,mode,C.advance(~S,~O,~M,~hooks,first,mode,cursor))
    : C.Cursor<S,O,M>}

law planning_preserves_observed_experience:
  for budget: Nat
  for values: T.Table
  for +experience: Dyna.Model
  for +pairs: U32
  for +seed: U32
  for +alpha: F32
  for +gamma: F32
  {Dyna.experience(Dyna.plan(budget,values,experience,pairs,seed,alpha,gamma)) == experience : Dyna.Model}

# A critic must not bootstrap through a physical failure. A time cutoff
# leaves an Open view and is deliberately outside the statement.
law actor_terminal_has_no_continuation:
  for model: AC.Model
  for state: Pole.State
  {AC.continuation(model,E.End{state}) == 0.0 : F32}

law offline_terminal_has_no_continuation:
  for method: Offline.Method
  for q: T.Table
  for counts: T.Table
  for s: U32
  {Offline.future(method,q,counts,E.End{s}) == 0.0 : F32}

# Unknown actions cannot improve the empirical-support maximum, even
# when the initial zero estimate exceeds all observed negative rewards.
law unsupported_action_cannot_enter_backup:
  for a: U32
  for q: T.Table
  for s: U32
  for options: T.Choices
  {Offline.consider(Offline.Supported{},a,0,q,s,options) == options : T.Choices}

law zero_planning_keeps_real_update:
  for q: T.Table
  for experience: Dyna.Model
  for pairs: U32
  for seed: U32
  for alpha: F32
  for gamma: F32
  {Dyna.values(Dyna.plan(0n,q,experience,pairs,seed,alpha,gamma)) == q : T.Table}

# Arena rewards use first-seat units; player values use the acting seat's units.
law arena_second_seat_payoff:
  for reward: F32
  {Arena.perspective(True{},reward) == F32.neg(reward) : F32}

law arena_finished_game_has_no_bootstrap:
  for method: Player.Method
  for buckets: U32
  for table: ArenaTable.Tree
  {Player.first_value(method,buckets,table,E.End{Arena.Over{}}) == 0.0 : F32}
