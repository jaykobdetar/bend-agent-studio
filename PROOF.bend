import Base
import ./LAWS.bend as Laws
import ./engine.bend as E
import ./study.bend as Study
import ./weights.bend as W
import ./cursor.bend as C
import ./dyna.bend as Dyna
import ./tabular.bend as T

def Laws.evaluation_freezes_model(M, O, learn, model, event):
  {==}

def Laws.training_uses_one_update(M, O, learn, model, event):
  {==}

def Laws.rejection_preserves_progress(S, O, M, hooks, mode, remaining, state, observation,
                                      model, action, seed, score, steps):
  {==}

def Laws.terminal_view_stops(S, O, M, state, model, seed, score, steps, observation):
  {==}

def Laws.open_at_limit_is_truncated(O, obs, actions):
  {==}

def Laws.terminal_is_never_truncated(O, remaining, obs):
  match remaining:
    case 0n:
      {==}
    case 1n+rest:
      {==}

def add_successor(a: Nat, +b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n: {==}
    case 1n++p:
      Equal.cong(Nat, Nat, x => 1n+x, Nat.add(p, 1n+b), 1n+Nat.add(p, b), add_successor(p, b))

def Laws.every_report_counts_once(totals, score, steps, reason):
  match totals reason:
    case E.Totals{s, n, t, l, i} E.Terminal{}:
      {==}
    case E.Totals{s, n, t, l, i} E.Limit{}:
      add_successor(t, Nat.add(l, i))
    case E.Totals{s, n, +t, +l, +i} E.Illegal{a}:
      Equal.trans(Nat, Nat.add(t, Nat.add(l, 1n+i)), Nat.add(t, 1n+Nat.add(l, i)), 1n+Nat.add(t, Nat.add(l, i)),
        Equal.cong(Nat, Nat, x => Nat.add(t, x), Nat.add(l, 1n+i), 1n+Nat.add(l, i), add_successor(l, i)),
        add_successor(t, Nat.add(l, i)))

def Laws.terminal_has_no_continuation(method, exploration, values, obs):
  match method:
    case Study.Uniform{}: {==}
    case Study.MeanReward{}: {==}
    case Study.QLearning{}: {==}
    case Study.ExpectedSarsa{}: {==}
    case Study.DoubleQ{}: {==}
    case Study.DynaQ{p}: {==}

def Laws.evaluation_disables_exploration(exploration, word):
  {==}

def Laws.double_q_left_preserves_right(left, right, seed, alpha, gamma, event):
  {==}

def Laws.double_q_right_preserves_left(left, right, seed, alpha, gamma, event):
  {==}

def Laws.weight_read_after_write(at, tree, row):
  match at:
    case W.Here{}: {==}
    case W.Low{rest}: Laws.weight_read_after_write(rest, W.low(tree), row)
    case W.High{rest}: Laws.weight_read_after_write(rest, W.high(tree), row)

def Laws.low_write_preserves_high(suffix, tree, row): {==}

def Laws.high_write_preserves_low(suffix, tree, row): {==}

def Laws.tile_terminal_has_no_continuation(method, buckets, tree, state): {==}

def Laws.history_preserves_legal_actions(O, Hid, F, encode, h, obs, legal): {==}
def Laws.history_preserves_reward(S, O, Hid, show, remember, h, obs, action, next, reward): {==}

def observer_invariant(~S: Data, ~O: Data, ~M: Data, ~hooks: E.Hooks<S,O,M>, ~A: Data,
    ~observe: A -> O -> List<&2,U32> -> U32 -> Maybe<&2,E.Transition<O>> -> A,
    fuel: Nat, +mode: E.Mode, run: E.Run<S,O,M>, record: A) ->
    {E.report_of(A, M, E.drive(~S,~O,~M,~hooks,~A,~observe,fuel,mode,run,record)) ==
     E.roll(~S,~O,~M,~hooks,fuel,mode,run) : E.Report<M>}:
  match fuel run:
    case _ E.Stopped{report}: {==}
    case 0n E.Live{state, obs, actions, model, seed, score, steps}: {==}
    case 1n++rest E.Live{state, +obs, +actions, +model, +seed, score, steps}:
      +action = E.get_policy(S,O,M,hooks)(model,obs,actions,mode,seed)
      valid = List.contains(~U32,~U32.is_eq,actions,action)
      +turn = E.attempt(S,O,M,hooks,valid,mode,rest,state,obs,model,action,E.next_seed(seed),score,steps)
      next = observe(record,obs,actions,action,E.turn_event(S,O,M,turn))
      observer_invariant(~S,~O,~M,~hooks,~A,~observe,rest,mode,E.turn_run(S,O,M,turn),next)

def Laws.observer_preserves_report(S,O,M,hooks,A,observe,fuel,mode,run,record):
  observer_invariant(~S,~O,~M,~hooks,~A,~observe,fuel,mode,run,record)

def stopped_stays_stopped(~S: Data, ~O: Data, ~M: Data, ~hooks: E.Hooks<S,O,M>, budget: Nat,
                          mode: E.Mode, left: Nat, report: E.Report<M>) ->
  {C.Cursor{left,E.Stopped{report}} == C.advance(~S,~O,~M,~hooks,budget,mode,C.Cursor{left,E.Stopped{report}}) : C.Cursor<S,O,M>}:
  match budget:
    case 0n: {==}
    case 1n+p: {==}

def exhausted_stays_exhausted(~S: Data, ~O: Data, ~M: Data, ~hooks: E.Hooks<S,O,M>, budget: Nat,
    mode: E.Mode, state: S, obs: O, acts: List<&2,U32>, model: M, word: U32, score: F32, steps: Nat) ->
  {C.Cursor{0n,E.Live{state,obs,acts,model,word,score,steps}} ==
   C.advance(~S,~O,~M,~hooks,budget,mode,C.Cursor{0n,E.Live{state,obs,acts,model,word,score,steps}}) : C.Cursor<S,O,M>}:
  match budget:
    case 0n: {==}
    case 1n+p: {==}

def split_budget(~S: Data,~O: Data,~M: Data,~hooks: E.Hooks<S,O,M>, first: Nat, second: Nat,
                 +mode: E.Mode, cursor: C.Cursor<S,O,M>) ->
  {C.advance(~S,~O,~M,~hooks,Nat.add(first,second),mode,cursor) ==
   C.advance(~S,~O,~M,~hooks,second,mode,C.advance(~S,~O,~M,~hooks,first,mode,cursor)) : C.Cursor<S,O,M>}:
  match first cursor:
    case 0n c: {==}
    case 1n+p C.Cursor{left,E.Stopped{r}}:
      stopped_stays_stopped(~S,~O,~M,~hooks,second,mode,left,r)
    case 1n+p C.Cursor{0n,E.Live{state,obs,acts,model,word,score,steps}}:
      exhausted_stays_exhausted(~S,~O,~M,~hooks,second,mode,state,obs,acts,model,word,score,steps)
    case 1n+p C.Cursor{1n+left,E.Live{state,obs,acts,model,word,score,steps}}:
      next = C.one(~S,~O,~M,~hooks,mode,C.Cursor{1n+left,E.Live{state,obs,acts,model,word,score,steps}})
      split_budget(~S,~O,~M,~hooks,p,second,mode,next)

def Laws.pause_composes(S,O,M,hooks,first,second,mode,cursor):
  split_budget(~S,~O,~M,~hooks,first,second,mode,cursor)

def Laws.planning_preserves_observed_experience(budget, values, experience, pairs, seed, alpha, gamma):
  match budget:
    case 0n: {==}
    case 1n+rest:
      index = U32.to_nat(U32.mod(E.mix_word(seed),U32.max(1,pairs)))
      updated = Dyna.backup(values,alpha,gamma,List.get(&2,Dyna.PairModel,experience,index))
      Laws.planning_preserves_observed_experience(rest,updated,experience,pairs,E.next_seed(seed),alpha,gamma)

def Laws.actor_terminal_has_no_continuation(model,state): {==}
def Laws.offline_terminal_has_no_continuation(method,q,counts,s): {==}
def Laws.unsupported_action_cannot_enter_backup(a,q,s,options): {==}
def Laws.zero_planning_keeps_real_update(q,experience,pairs,seed,alpha,gamma): {==}

def Laws.arena_second_seat_payoff(reward): {==}
def Laws.arena_finished_game_has_no_bootstrap(method,buckets,table): {==}
