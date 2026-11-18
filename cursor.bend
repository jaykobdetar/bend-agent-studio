import Base
import ./engine.bend as E

# A cursor carries the world's own remaining horizon between checkpoints.
# Sampling a partial training run never changes that horizon.
type Cursor<-S: Data, -O: Data, -M: Data> is Data:
  Cursor{remaining: Nat, run: E.Run<S,O,M>}
  Finalized{report: E.Report<M>}

def start(~S: Data, ~O: Data, ~M: Data, ~hooks: E.Hooks<S,O,M>, model: M, seed: U32, limit: Nat) -> Cursor<S,O,M>:
  Cursor{limit, E.reset_run(S,O,M,E.get_world(S,O,M,hooks),model,seed)}

def one(~S: Data, ~O: Data, ~M: Data, ~hooks: E.Hooks<S,O,M>, mode: E.Mode, cursor: Cursor<S,O,M>) -> Cursor<S,O,M>:
  match cursor:
    case Finalized{report}: Finalized{report}
    case Cursor{left, E.Stopped{report}}: Cursor{left,E.Stopped{report}}
    case Cursor{0n, live}: Cursor{0n,live}
    case Cursor{1n++remaining, E.Live{state,obs,actions,model,word,score,steps}}:
      choice = E.decide(~S,~O,~M,~E.mixed_hooks(S,O,M,hooks),mode,remaining,state,obs,actions,model,word,score,steps)
      Cursor{remaining, E.turn_run(S,O,M,E.decision_turn(S,O,M,choice))}

def model(-S: Data, -O: Data, -M: Data, cursor: Cursor<S,O,M>) -> M:
  match cursor:
    case Finalized{report}: E.get_model(M,report)
    case Cursor{n,E.Live{state,obs,actions,m,word,score,steps}}: m
    case Cursor{n,E.Stopped{report}}: E.get_model(M,report)

def steps(-S: Data, -O: Data, -M: Data, cursor: Cursor<S,O,M>) -> Nat:
  match cursor:
    case Finalized{E.Report{m,value,count,reason}}: count
    case Cursor{n,E.Live{state,obs,actions,m,word,score,count}}: count
    case Cursor{n,E.Stopped{E.Report{m,score,count,reason}}}: count

def score(-S: Data, -O: Data, -M: Data, cursor: Cursor<S,O,M>) -> F32:
  match cursor:
    case Finalized{E.Report{m,value,count,reason}}: value
    case Cursor{n,E.Live{state,obs,actions,m,word,value,count}}: value
    case Cursor{n,E.Stopped{E.Report{m,value,count,reason}}}: value

def finished(-S: Data, -O: Data, -M: Data, cursor: Cursor<S,O,M>) -> Maybe<&2,E.Report<M>>:
  match cursor:
    case Finalized{report}: Some{report}
    case Cursor{n,E.Stopped{report}}: Some{report}
    case Cursor{0n,E.Live{state,obs,actions,m,word,r,steps}}: Some{E.Report{m,r,steps,E.Limit{}}}
    case _: None{}

def continue_open(~S: Data,~O: Data,~M: Data,~hooks: E.Hooks<S,O,M>,
                  left: Nat, mode: E.Mode, live: E.Run<S,O,M>,
                  more: Cursor<S,O,M> -> Cursor<S,O,M>) -> Cursor<S,O,M>:
  match left:
    case 0n: Cursor{0n,live}
    case 1n+n: more(one(~S,~O,~M,~hooks,mode,Cursor{1n+n,live}))

def continue_run(~S: Data,~O: Data,~M: Data,~hooks: E.Hooks<S,O,M>,
                 run: E.Run<S,O,M>, left: Nat, mode: E.Mode,
                 more: Cursor<S,O,M> -> Cursor<S,O,M>) -> Cursor<S,O,M>:
  match run:
    case E.Stopped{r}: Cursor{left,E.Stopped{r}}
    case E.Live{s,o,a,m,w,r,n}:
      continue_open(~S,~O,~M,~hooks,left,mode,E.Live{s,o,a,m,w,r,n},more)

def continue_cursor(~S: Data,~O: Data,~M: Data,~hooks: E.Hooks<S,O,M>,
    cursor: Cursor<S,O,M>, mode: E.Mode, more: Cursor<S,O,M> -> Cursor<S,O,M>) -> Cursor<S,O,M>:
  match cursor:
    case Finalized{report}: Finalized{report}
    case Cursor{left,run}: continue_run(~S,~O,~M,~hooks,run,left,mode,more)

def advance(~S: Data, ~O: Data, ~M: Data, ~hooks: E.Hooks<S,O,M>, budget: Nat, +mode: E.Mode,
            cursor: Cursor<S,O,M>) -> Cursor<S,O,M>:
  match budget:
    case 0n: cursor
    case 1n+rest:
      continue_cursor(~S,~O,~M,~hooks,cursor,mode,c => advance(~S,~O,~M,~hooks,rest,mode,c))

# Only opted-in hooks need a completion marker. Legacy cursor shapes stay exact.
def seal_result(-S: Data,-O: Data,-M: Data,hooks: E.Hooks<S,O,M>,mode: E.Mode,cursor: Cursor<S,O,M>,report: Maybe<&2,E.Report<M>>) -> Cursor<S,O,M>:
  match report:
    case None{}: cursor
    case Some{r}: Finalized{E.finish_report(S,O,M,hooks,mode,r)}

def finalize(-S: Data,-O: Data,-M: Data,hooks: E.Hooks<S,O,M>,mode: E.Mode,+cursor: Cursor<S,O,M>) -> Cursor<S,O,M>:
  match hooks cursor:
    case E.Hooks{world,act,learn} c: c
    case E.Finishing{world,act,learn,finish} Finalized{r}: Finalized{r}
    case E.Finishing{world,act,learn,finish} c:
      seal_result(S,O,M,E.Finishing{world,act,learn,finish},mode,c,finished(S,O,M,c))

# The host sees only this summary while scheduling training; it stores the
# opaque cursor for an unfinished episode and hands it back to Bend to resume.
type Segment<-S: Data,-O: Data,-M: Data> is Data:
  Segment{cursor: Cursor<S,O,M>, model: M, steps: Nat, score: F32, finished: Maybe<&2,E.Report<M>>}

def segment(~S: Data,~O: Data,~M: Data,~hooks: E.Hooks<S,O,M>, +mode: E.Mode, budget: Nat,
            cursor: Cursor<S,O,M>) -> Segment<S,O,M>:
  +c = finalize(S,O,M,hooks,mode,advance(~S,~O,~M,~hooks,budget,mode,cursor))
  Segment{c,model(S,O,M,c),steps(S,O,M,c),score(S,O,M,c),finished(S,O,M,c)}
