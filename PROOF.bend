import Base
import ./LAWS.bend as Laws
import ./engine.bend as E
import ./study.bend as Study
import ./weights.bend as W
import ./cursor.bend as C
import ./dyna.bend as Dyna
import ./tabular.bend as T
import ./double_q.bend as DQ

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

def Laws.positive_budget_is_never_truncated(O, n, view):
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

def le_self(n: Nat) -> {Nat.is_le(n,n) == True{} : Bool}:
  match n:
    case 0n: {==}
    case 1n+p: le_self(p)

def allow_one(a: Nat, b: Nat, h: {Nat.is_le(a,b) == True{} : Bool}) ->
    {Nat.is_le(a,1n+b) == True{} : Bool}:
  match a b:
    case 0n 0n: {==}
    case 0n 1n+q: {==}
    case 1n+0n 0n: {==}
    case 1n+1n+k 0n: h
    case 1n+p 1n+q: allow_one(p,q,h)

def initial_bound(fuel: Nat, +s: Nat) -> {Nat.is_le(s,Nat.add(fuel,s)) == True{} : Bool}:
  match fuel:
    case 0n: le_self(s)
    case 1n++rest: allow_one(s,Nat.add(rest,s),initial_bound(rest,s))

# Project the real E.attempt path to the step count: an accepted transition
# increments exactly once even when it ends the episode; rejection leaves it alone.
def count_if(valid: Bool, steps: Nat) -> Nat:
  match valid:
    case False{}: steps
    case True{}: 1n+steps

def count_place(-S: Data,-O: Data,-M: Data,state:S,model:M,seed:U32,score:F32,steps:Nat,view:E.View<O>) ->
  {Laws.run_steps(S,O,M,E.place(S,O,M,state,model,seed,score,steps,view)) == steps : Nat}:
  match view:
    case E.End{o}: {==}
    case E.Open{o,acts}: {==}

def count_recorded(-S:Data,-O:Data,-M:Data,inspect:S -> E.View<O>,learn:M -> E.Transition<O> -> M,
    mode:E.Mode,remaining:Nat,obs:O,model:M,action:U32,seed:U32,score:F32,steps:Nat,result:Pair(S,F32)) ->
  {Laws.run_steps(S,O,M,E.turn_run(S,O,M,E.recorded_step(S,O,M,inspect,learn,mode,remaining,
    obs,model,action,seed,score,steps,result))) == 1n+steps : Nat}:
  match result:
    case (+after,+reward):
      +view = inspect(after)
      event = {E.Transition{obs,action,reward,view,E.truncated(O,remaining,view)} : E.Transition<O>}
      count_place(S,O,M,after,E.update(M,O,learn,mode,model,event),seed,F32.add(score,reward),1n+steps,view)

def count_perform(-S:Data,-O:Data,-M:Data,hooks:E.Hooks<S,O,M>,mode:E.Mode,remaining:Nat,state:S,
    obs:O,model:M,+action:U32,+seed:U32,score:F32,steps:Nat) ->
  {Laws.run_steps(S,O,M,E.turn_run(S,O,M,E.perform(S,O,M,hooks,mode,remaining,state,obs,model,action,seed,score,steps)))
    == 1n+steps : Nat}:
  match hooks:
    case E.Hooks{E.World{reset,inspect,step},act,learn}:
      count_recorded(S,O,M,inspect,learn,mode,remaining,obs,model,action,E.next_seed(seed),score,steps,step(state,action,seed))

def count_attempt(-S:Data,-O:Data,-M:Data,hooks:E.Hooks<S,O,M>,valid:Bool,mode:E.Mode,remaining:Nat,state:S,
    obs:O,model:M,action:U32,seed:U32,score:F32,steps:Nat) ->
  {Laws.run_steps(S,O,M,E.turn_run(S,O,M,E.attempt(S,O,M,hooks,valid,mode,remaining,state,obs,model,action,seed,score,steps)))
    == count_if(valid,steps) : Nat}:
  match valid:
    case False{}: {==}
    case True{}: count_perform(S,O,M,hooks,mode,remaining,state,obs,model,action,seed,score,steps)

def raise_bound(+end:Nat,a:Nat,b:Nat,e:{a == b : Nat},h:{Nat.is_le(end,a) == True{} : Bool}) ->
  {Nat.is_le(end,b) == True{} : Bool}:
  %e : {Nat.is_le(end,_) == True{} : Bool}
  h

def tick_bound(+valid:Bool,+rest:Nat,+steps:Nat,+end:Nat,
    h:{Nat.is_le(end,Nat.add(rest,count_if(valid,steps))) == True{} : Bool}) ->
  {Nat.is_le(end,1n+Nat.add(rest,steps)) == True{} : Bool}:
  match valid:
    case False{}: allow_one(end,Nat.add(rest,steps),h)
    case True{}: raise_bound(end,Nat.add(rest,1n+steps),1n+Nat.add(rest,steps),add_successor(rest,steps),h)

# Consume fuel by induction. Transfer the recursive bound from the actual
# successor run using count_attempt, then account for this one unit of fuel.
def Laws.roll_steps_within_budget(S,O,M,hooks,fuel,mode,run):
  match fuel run:
    case +n E.Stopped{E.Report{m,r,+s,why}}: initial_bound(n,s)
    case 0n E.Live{state,obs,acts,model,seed,score,steps}: le_self(steps)
    case 1n++rest E.Live{+state,+obs,+actions,+model,+seed,+score,+steps}:
      +action = E.get_policy(S,O,M,hooks)(model,obs,actions,mode,seed)
      +valid = List.contains(~U32,~U32.is_eq,actions,action)
      +next = E.turn_run(S,O,M,E.attempt(S,O,M,hooks,valid,mode,rest,state,obs,model,action,E.next_seed(seed),score,steps))
      +end = Laws.report_steps(M,E.roll(~S,~O,~M,~hooks,rest,mode,next))
      eq = count_attempt(S,O,M,hooks,valid,mode,rest,state,obs,model,action,E.next_seed(seed),score,steps)
      lift = Equal.cong(Nat,Nat,n => Nat.add(rest,n),Laws.run_steps(S,O,M,next),count_if(valid,steps),eq)
      ih = Laws.roll_steps_within_budget(S,O,M,hooks,rest,mode,next)
      tick_bound(valid,rest,steps,end,raise_bound(end,Nat.add(rest,Laws.run_steps(S,O,M,next)),Nat.add(rest,count_if(valid,steps)),lift,ih))

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

# Adding a head to either kind of tail makes a genuine choice, so both
# sides read the very same action from the evaluating table.
def evaluate_considered(right: T.Table, obs: U32, a: U32, value: F32, tail: T.Choices)
    -> {DQ.evaluate_best(right, obs, T.consider(a, value, tail))
       == T.lookup(right, obs, T.best_action(T.consider(a, value, tail))) : F32}:
  match tail:
    case T.NoChoices{}: {==}
    case T.Choices{best, maximum, sum, count}: {==}

def Laws.double_q_bootstraps_from_other_table(left, right, obs, a, rest):
  evaluate_considered(right, obs, a, T.lookup(left, obs, a), T.choices(rest, left, obs))

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

def placed_account(-S: Data,-O: Data,+mode:E.Mode,state:S,m:Nat,seed:U32,score:F32,steps:Nat,view:E.View<O>) ->
  {Laws.run_account(S,O,mode,E.place(S,O,Nat,state,m,seed,score,steps,view)) == Laws.accounting(mode,m,steps) : Pair(Nat,Nat)}:
  match view:
    case E.Open{obs,actions}: {==}
    case E.End{obs}: {==}

def recorded_account(~S:Data,~O:Data,~inspect:S -> E.View<O>,mode:E.Mode,remaining:Nat,obs:O,m:Nat,
                     action:U32,seed:U32,score:F32,steps:Nat,result:Pair(S,F32)) ->
  {Laws.run_account(S,O,mode,E.turn_run(S,O,Nat,E.recorded_step(S,O,Nat,inspect,Laws.counting(O),mode,remaining,
        obs,m,action,seed,score,steps,result))) == Laws.accounting(mode,m,steps) : Pair(Nat,Nat)}:
  match mode:
    case E.Train{}:
      (+after,reward) = result
      placed_account(S,O,E.Train{},after,1n+m,seed,F32.add(score,reward),1n+steps,inspect(after))
    case E.Evaluate{}:
      (+after,reward) = result
      placed_account(S,O,E.Evaluate{},after,m,seed,F32.add(score,reward),1n+steps,inspect(after))

def attempted_account(~S:Data,~O:Data,~reset:U32 -> S,~inspect:S -> E.View<O>,~step:S -> U32 -> U32 -> Pair(S,F32),
                      ~act:Nat -> O -> List<&2,U32> -> E.Mode -> U32 -> U32,valid:Bool,+mode:E.Mode,
                      remaining:Nat,state:S,obs:O,m:Nat,+action:U32,+seed:U32,score:F32,steps:Nat) ->
  {Laws.run_account(S,O,mode,E.turn_run(S,O,Nat,E.attempt(S,O,Nat,E.Hooks{E.World{reset,inspect,step},act,Laws.counting(O)},
                                valid,mode,remaining,state,obs,m,action,seed,score,steps))) == Laws.accounting(mode,m,steps) : Pair(Nat,Nat)}:
  match valid:
    case False{}: {==}
    case True{}:
      recorded_account(~S,~O,~inspect,mode,remaining,obs,m,action,E.next_seed(seed),score,steps,step(state,action,seed))

def episode_account(~S:Data,~O:Data,~reset:U32 -> S,~inspect:S -> E.View<O>,~step:S -> U32 -> U32 -> Pair(S,F32),
                    ~act:Nat -> O -> List<&2,U32> -> E.Mode -> U32 -> U32,fuel:Nat,+mode:E.Mode,+run:E.Run<S,O,Nat>) ->
  {Laws.report_account(mode,E.roll(~S,~O,~Nat,~E.Hooks{E.World{reset,inspect,step},act,Laws.counting(O)},fuel,mode,run)) ==
   Laws.run_account(S,O,mode,run) : Pair(Nat,Nat)}:
  match fuel run:
    case _ E.Stopped{report}: {==}
    case 0n E.Live{state,obs,actions,m,seed,score,steps}: {==}
    case 1n++rest E.Live{+state,+obs,+actions,+m,+seed,+score,+steps}:
      +action = act(m,obs,actions,mode,seed)
      +valid = List.contains(~U32,~U32.is_eq,actions,action)
      +world_seed = E.next_seed(seed)
      +next = E.turn_run(S,O,Nat,E.attempt(S,O,Nat,E.Hooks{E.World{reset,inspect,step},act,Laws.counting(O)},
                              valid,mode,rest,state,obs,m,action,world_seed,score,steps))
      Equal.trans(Pair(Nat,Nat),
        Laws.report_account(mode,E.roll(~S,~O,~Nat,~E.Hooks{E.World{reset,inspect,step},act,Laws.counting(O)},rest,mode,next)),
        Laws.run_account(S,O,mode,next),Laws.accounting(mode,m,steps),
        episode_account(~S,~O,~reset,~inspect,~step,~act,rest,mode,next),
        attempted_account(~S,~O,~reset,~inspect,~step,~act,valid,mode,rest,state,obs,m,action,world_seed,score,steps))

def Laws.evaluation_episode_freezes_counter(S,O,reset,inspect,step,act,fuel,run):
  episode_account(~S,~O,~reset,~inspect,~step,~act,fuel,E.Evaluate{},run)

def Laws.training_episode_counts_accepted_steps(S,O,reset,inspect,step,act,fuel,run):
  episode_account(~S,~O,~reset,~inspect,~step,~act,fuel,E.Train{},run)

# Stronger induction hypothesis: resume from any run with exactly its fuel.
# Cursor.one applies the mixed hooks; roll itself receives the same mixed hooks.
def cursor_completes_roll(~S:Data,~O:Data,~M:Data,~hooks:E.Hooks<S,O,M>,+fuel:Nat,+mode:E.Mode,+run:E.Run<S,O,M>) ->
  {C.finished(S,O,M,C.advance(~S,~O,~M,~hooks,fuel,mode,C.Cursor{fuel,run})) ==
    Some{E.roll(~S,~O,~M,~E.mixed_hooks(S,O,M,hooks),fuel,mode,run)} : Maybe<&2,E.Report<M>>}:
  match fuel run:
    case 0n E.Stopped{report}: {==}
    case 0n E.Live{state,obs,actions,model,word,score,steps}: {==}
    case 1n+left E.Stopped{report}: {==}
    case 1n++left E.Live{state,obs,actions,model,word,score,steps}:
      choice=E.decide(~S,~O,~M,~E.mixed_hooks(S,O,M,hooks),mode,left,state,obs,actions,model,word,score,steps)
      next=E.turn_run(S,O,M,E.decision_turn(S,O,M,choice))
      cursor_completes_roll(~S,~O,~M,~hooks,left,mode,next)

def Laws.cursor_finishes_as_episode(S,O,M,reset,inspect,step,act,learn,model,seed,mode,limit):
  cursor_completes_roll(~S,~O,~M,~E.Hooks{E.World{reset,inspect,step},act,learn},limit,mode,
    E.reset_run(S,O,M,E.World{reset,inspect,step},model,seed))
