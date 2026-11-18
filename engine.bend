import Base

type Mode is Data:
  Train{}
  Evaluate{}

type Stop is Data:
  Terminal{}
  Limit{}
  Illegal{action: U32}

type View<-O: Data> is Data:
  Open{observation: O, actions: List<&2, U32>}
  End{observation: O}

type World<-S: Data, -O: Data> is Type:
  World{reset: U32 -> S, view: S -> View<O>, step: S -> U32 -> U32 -> Pair(S, F32)}

type Transition<-O: Data> is Data:
  Transition{observation: O, action: U32, reward: F32, next: View<O>, truncated: Bool}

type Hooks<-S: Data, -O: Data, -M: Data> is Type:
  Hooks{world: World<S, O>, act: M -> O -> List<&2, U32> -> Mode -> U32 -> U32,
        learn: M -> Transition<O> -> M}

type Report<-M: Data> is Data:
  Report{model: M, score: F32, steps: Nat, reason: Stop}

type Run<-S: Data, -O: Data, -M: Data> is Data:
  Live{state: S, observation: O, actions: List<&2, U32>, model: M, seed: U32, score: F32, steps: Nat}
  Stopped{report: Report<M>}

type Turn<-S: Data, -O: Data, -M: Data> is Data:
  Turn{run: Run<S, O, M>, event: Maybe<&2, Transition<O>>}

type Observed<-A: Data, -M: Data> is Data:
  Observed{record: A, report: Report<M>}

def turn_run(-S: Data, -O: Data, -M: Data, turn: Turn<S, O, M>) -> Run<S, O, M>:
  Turn{run, event} = turn
  run

def turn_event(-S: Data, -O: Data, -M: Data, turn: Turn<S, O, M>) -> Maybe<&2, Transition<O>>:
  Turn{run, event} = turn
  event

def report_of(-A: Data, -M: Data, result: Observed<A, M>) -> Report<M>:
  Observed{record, report} = result
  report

def get_world(-S: Data, -O: Data, -M: Data, hooks: Hooks<S, O, M>) -> World<S, O>:
  Hooks{world, act, learn} = hooks
  world

def get_policy(-S: Data, -O: Data, -M: Data, hooks: Hooks<S, O, M>) ->
    M -> O -> List<&2, U32> -> Mode -> U32 -> U32:
  Hooks{world, act, learn} = hooks
  act

# A reproducible stream of unsigned 32-bit words (arithmetic wraps).
def next_seed(seed: U32) -> U32:
  U32.add(U32.mul(seed, 1664525), 1013904223)

# MurmurHash3 fmix32 avalanches the low bits of the LCG. Different domain
# constants keep the policy and world from sampling the same bit pattern.
def mix_word(+word: U32) -> U32:
  +a = U32.mul(U32.xor(word, U32.shrn(word, 16n)), 2246822507)
  +b = U32.mul(U32.xor(a, U32.shrn(a, 13n)), 3266489909)
  U32.xor(b, U32.shrn(b, 16n))

def mixed_hooks(-S: Data, -O: Data, -M: Data, hooks: Hooks<S, O, M>) -> Hooks<S, O, M>:
  Hooks{World{reset, view, step}, act, learn} = hooks
  Hooks{World{reset, view, s => a => w => step(s, a, mix_word(U32.xor(w, 2779096485)))},
        m => o => actions => mode => w => act(m, o, actions, mode, mix_word(U32.xor(w, 1515870810))), learn}

def place(-S: Data, -O: Data, -M: Data, state: S, model: M, seed: U32,
          score: F32, steps: Nat, view: View<O>) -> Run<S, O, M>:
  match view:
    case End{obs}:
      Stopped{Report{model, score, steps, Terminal{}}}
    case Open{obs, actions}:
      Live{state, obs, actions, model, seed, score, steps}

def truncated(-O: Data, remaining: Nat, view: View<O>) -> Bool:
  match remaining view:
    case 0n Open{obs, actions}:
      True{}
    case _ _:
      False{}

def update(-M: Data, -O: Data, learn: M -> Transition<O> -> M, mode: Mode,
           model: M, transition: Transition<O>) -> M:
  match mode:
    case Train{}:
      learn(model, transition)
    case Evaluate{}:
      model

def recorded_step(-S: Data, -O: Data, -M: Data, inspect: S -> View<O>,
                  learn: M -> Transition<O> -> M, mode: Mode, remaining: Nat,
                  observation: O, model: M, action: U32, seed: U32, score: F32,
                  steps: Nat, result: Pair(S, F32)) -> Turn<S, O, M>:
  (+after, +reward) = result
  +view = inspect(after)
  +event = {Transition{observation, action, reward, view, truncated(O, remaining, view)} : Transition<O>}
  learned = update(M, O, learn, mode, model, event)
  Turn{place(S, O, M, after, learned, seed, F32.add(score, reward), 1n+steps, view), Some{event}}

def perform(-S: Data, -O: Data, -M: Data, hooks: Hooks<S, O, M>,
            mode: Mode, remaining: Nat, state: S, observation: O, model: M,
            +action: U32, +seed: U32, score: F32, steps: Nat) -> Turn<S, O, M>:
  Hooks{World{reset, inspect, step}, act, learn} = hooks
  recorded_step(S, O, M, inspect, learn, mode, remaining, observation, model, action,
                next_seed(seed), score, steps, step(state, action, seed))

def attempt(-S: Data, -O: Data, -M: Data, hooks: Hooks<S, O, M>,
            valid: Bool, mode: Mode, remaining: Nat, state: S, observation: O,
            model: M, action: U32, world_seed: U32, score: F32, steps: Nat) -> Turn<S, O, M>:
  match valid:
    case False{}: Turn{Stopped{Report{model, score, steps, Illegal{action}}}, None{}}
    case True{}: perform(S, O, M, hooks, mode, remaining, state, observation, model, action, world_seed, score, steps)

type Decision<-S: Data, -O: Data, -M: Data> is Data:
  Decision{action: U32, turn: Turn<S,O,M>}

def decision_action(-S: Data, -O: Data, -M: Data, decision: Decision<S,O,M>) -> U32:
  Decision{action, turn} = decision
  action

def decision_turn(-S: Data, -O: Data, -M: Data, decision: Decision<S,O,M>) -> Turn<S,O,M>:
  Decision{action, turn} = decision
  turn

def decide(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S,O,M>, +mode: Mode, remaining: Nat,
           state: S, +obs: O, +actions: List<&2,U32>, +model: M, +seed: U32, score: F32, steps: Nat) -> Decision<S,O,M>:
  +action = get_policy(S,O,M,hooks)(model,obs,actions,mode,seed)
  valid = List.contains(~U32,~U32.is_eq,actions,action)
  Decision{action, attempt(S,O,M,hooks,valid,mode,remaining,state,obs,model,action,next_seed(seed),score,steps)}

# An observer accumulates public decisions. Its only output is the record.
# Both the ordinary runner and trace playback pass through this loop.
def drive(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>, ~A: Data,
          ~observe: A -> O -> List<&2, U32> -> U32 -> Maybe<&2, Transition<O>> -> A,
          fuel: Nat, +mode: Mode, run: Run<S, O, M>, record: A) -> Observed<A, M>:
  match fuel run:
    case _ Stopped{report}: Observed{record, report}
    case 0n Live{state, obs, actions, model, seed, score, steps}:
      Observed{record, Report{model, score, steps, Limit{}}}
    case 1n++rest Live{state, +obs, +actions, +model, +seed, score, steps}:
      +choice = decide(~S,~O,~M,~hooks,mode,rest,state,obs,actions,model,seed,score,steps)
      +turn = decision_turn(S,O,M,choice)
      next_record = observe(record, obs, actions, decision_action(S,O,M,choice), turn_event(S,O,M,turn))
      drive(~S, ~O, ~M, ~hooks, ~A, ~observe, rest, mode, turn_run(S, O, M, turn), next_record)

def roll(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>,
         fuel: Nat, mode: Mode, run: Run<S, O, M>) -> Report<M>:
  report_of(Unit, M, drive(~S, ~O, ~M, ~hooks, ~Unit, ~(acc => o => acts => a => ev => acc),
                          fuel, mode, run, Unit{}))

def reset_run(-S: Data, -O: Data, -M: Data, world: World<S, O>, model: M, +seed: U32) -> Run<S, O, M>:
  World{reset, inspect, step} = world
  +state = reset(seed)
  place(S, O, M, state, model, next_seed(seed), 0.0, 0n, inspect(state))

def episode_raw(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>,
            mode: Mode, model: M, seed: U32, limit: Nat) -> Report<M>:
  run = reset_run(S, O, M, get_world(S, O, M, hooks), model, seed)
  roll(~S, ~O, ~M, ~hooks, limit, mode, run)

def episode(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>,
            mode: Mode, model: M, seed: U32, limit: Nat) -> Report<M>:
  episode_raw(~S, ~O, ~M, ~mixed_hooks(S, O, M, hooks), mode, model, seed, limit)

def fold_episode(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>, ~A: Data,
                 ~observe: A -> O -> List<&2, U32> -> U32 -> Maybe<&2, Transition<O>> -> A,
                 mode: Mode, model: M, seed: U32, limit: Nat, record: A) -> Observed<A, M>:
  run = reset_run(S, O, M, get_world(S, O, M, hooks), model, seed)
  drive(~S, ~O, ~M, ~mixed_hooks(S, O, M, hooks), ~A, ~observe, limit, mode, run, record)

type Frame<-O: Data> is Data:
  Applied{observation: O, legal: List<&2, U32>, action: U32, reward: F32, next: View<O>, truncated: Bool}
  Refused{observation: O, legal: List<&2, U32>, action: U32}

def remember(-O: Data, frames: List<&2, Frame<O>>, obs: O, actions: List<&2, U32>, action: U32,
             event: Maybe<&2, Transition<O>>) -> List<&2, Frame<O>>:
  match event:
    case None{}: Refused{obs, actions, action} <> frames
    case Some{Transition{original, chosen, reward, next, truncated}}:
      Applied{obs, actions, action, reward, next, truncated} <> frames

def chronological(-O: Data, -M: Data, result: Observed<List<&2, Frame<O>>, M>) -> Observed<List<&2, Frame<O>>, M>:
  Observed{frames, report} = result
  Observed{List.reverse(&2, Frame<O>, frames), report}

def trace(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>, mode: Mode,
          model: M, seed: U32, limit: Nat) -> Observed<List<&2, Frame<O>>, M>:
  chronological(O, M, fold_episode(~S, ~O, ~M, ~hooks, ~List<&2, Frame<O>>, ~remember(O),
                                   mode, model, seed, limit, []))

type Totals is Data:
  Totals{score: F32, steps: Nat, terminal: Nat, limited: Nat, illegal: Nat}

def episode_count(totals: Totals) -> Nat:
  Totals{score, steps, terminal, limited, illegal} = totals
  Nat.add(terminal, Nat.add(limited, illegal))

def count(totals: Totals, score: F32, steps: Nat, reason: Stop) -> Totals:
  match totals reason:
    case Totals{s, n, t, l, i} Terminal{}:
      Totals{F32.add(s, score), Nat.add(steps, n), 1n+t, l, i}
    case Totals{s, n, t, l, i} Limit{}:
      Totals{F32.add(s, score), Nat.add(steps, n), t, 1n+l, i}
    case Totals{s, n, t, l, i} Illegal{a}:
      Totals{F32.add(s, score), Nat.add(steps, n), t, l, 1n+i}

def get_model(-M: Data, report: Report<M>) -> M:
  Report{model, score, steps, reason} = report
  model

def accumulate(-M: Data, totals: Totals, report: Report<M>) -> Totals:
  Report{model, score, steps, reason} = report
  count(totals, score, steps, reason)

def batch(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>, episodes: Nat,
          +limit: Nat, +mode: Mode, model: M, +seed: U32, totals: Totals) -> Pair(M, Totals):
  match episodes:
    case 0n:
      (model, totals)
    case 1n+rest:
      +report = episode(~S, ~O, ~M, ~hooks, mode, model, seed, limit)
      batch(~S, ~O, ~M, ~hooks, rest, limit, mode, get_model(M, report), U32.add(seed, 1),
            accumulate(M, totals, report))

def run(~S: Data, ~O: Data, ~M: Data, ~hooks: Hooks<S, O, M>, mode: Mode,
        model: M, seed: U32, episodes: Nat, limit: Nat) -> Pair(M, Totals):
  batch(~S, ~O, ~M, ~hooks, episodes, limit, mode, model, seed, Totals{0.0, 0n, 0n, 0n, 0n})
