import Base
import ./LAWS.bend as Laws
import ./engine.bend as E
import ./study.bend as Study
import ./weights.bend as W
import ./ferry.bend as Ferry
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

def Laws.ferry_observer_preserves_report(fuel, mode, run, record):
  observer_invariant(~Ferry.Stage,~U32,~Study.Model,~E.Hooks{Ferry.world(),Study.act,Study.learn},
    ~List<&2,E.Frame<U32>>,~E.remember(U32),fuel,mode,run,record)

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

def Laws.ferry_pause_composes(first, second, mode, cursor):
  split_budget(~Ferry.Stage,~U32,~Study.Model,~E.Hooks{Ferry.world(),Study.act,Study.learn},first,second,mode,cursor)

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

# Equality of raw observation/action words is the same predicate the list uses.
def bit_cmp_self(b: Bool) -> {Bool.cmp(b,b) == EQ{} : Cmp}:
  match b:
    case True{}: {==}
    case False{}: {==}

def word_cmp_self(n: Nat, w: Word(n)) -> {Word.cmp(n,w,w) == EQ{} : Cmp}:
  match n:
    case 0n: {==}
    case 1n+p:
      match w:
        case WCon{b,t}:
          Equal.trans(Cmp, Word.cmp.fin(b,b,Word.cmp(p,t,t)), Word.cmp.fin(b,b,EQ{}), EQ{},
            Equal.cong(Cmp,Cmp,c => Word.cmp.fin(b,b,c),Word.cmp(p,t,t),EQ{},word_cmp_self(p,t)), bit_cmp_self(b))

def u32_eq_self(x: U32) -> {U32.is_eq(x,x) == True{} : Bool}:
  match x:
    case U32{w}: Equal.cong(Cmp,Bool,Cmp.is_eq,Word.cmp(32n,w,w),EQ{},word_cmp_self(32n,w))

def key_eq_self(s: U32, a: U32) -> {(U32.is_eq(s,s) && U32.is_eq(a,a)) == True{} : Bool}:
  Equal.trans(Bool, U32.is_eq(s,s) && U32.is_eq(a,a), True{} && U32.is_eq(a,a), True{},
    Equal.cong(Bool,Bool,b => b && U32.is_eq(a,a),U32.is_eq(s,s),True{},u32_eq_self(s)),u32_eq_self(a))

def adjust_visits_cons(b: Bool,s: U32,a: U32,n: U32,v: F32,t: T.Table,k: U32,j: U32,r: T.Rate,target: F32,
                       ih: {T.visits(T.adjust(t,k,j,r,target),k,j) == U32.add(T.visits(t,k,j),1) : U32},
                       eq: {b == (U32.is_eq(s,k) && U32.is_eq(a,j)) : Bool}) ->
  {T.visits(T.replace_or_keep(b,u => T.revised(r,s,a,U32.add(n,1),v,target) <> t,
      u => T.Entry{s,a,n,v} <> T.adjust(t,k,j,r,target)),k,j) == U32.add(Bool.pick(U32,b,n,T.visits(t,k,j)),1) : U32}:
  match b:
    case True{}:
      %eq : {Bool.pick(U32,_,U32.add(n,1),T.visits(t,k,j)) == U32.add(n,1) : U32}
      {==}
    case False{}:
      %eq : {Bool.pick(U32,_,n,T.visits(T.adjust(t,k,j,r,target),k,j)) == U32.add(T.visits(t,k,j),1) : U32}
      ih

def Laws.table_adjust_visits(t,s,a,r,target):
  match t:
    case Nil{}:
      %Equal.sym(Bool,U32.is_eq(s,s) && U32.is_eq(a,a),True{},key_eq_self(s,a)) : {Bool.pick(U32,_,1,0) == 1 : U32}
      {==}
    case T.Entry{+x,+y,n,v} <> +tail:
      adjust_visits_cons(U32.is_eq(x,s) && U32.is_eq(y,a),x,y,n,v,tail,s,a,r,target,Laws.table_adjust_visits(tail,s,a,r,target),{==})

def adjust_value_cons(b: Bool,s: U32,a: U32,n: U32,v: F32,t: T.Table,k: U32,j: U32,r: T.Rate,target: F32,
                       ih: {T.lookup(T.adjust(t,k,j,r,target),k,j) ==
                         T.entry_value(T.revised(r,k,j,U32.add(T.visits(t,k,j),1),T.lookup(t,k,j),target)) : F32},
                       eq: {b == (U32.is_eq(s,k) && U32.is_eq(a,j)) : Bool}) ->
  {T.lookup(T.replace_or_keep(b,u => T.revised(r,s,a,U32.add(n,1),v,target) <> t,
      u => T.Entry{s,a,n,v} <> T.adjust(t,k,j,r,target)),k,j) ==
   T.entry_value(T.revised(r,k,j,U32.add(Bool.pick(U32,b,n,T.visits(t,k,j)),1),Bool.pick(F32,b,v,T.lookup(t,k,j)),target)) : F32}:
  match b:
    case True{}:
      %eq : {Bool.pick(F32,_,T.entry_value(T.revised(r,s,a,U32.add(n,1),v,target)),T.lookup(t,k,j)) ==
        T.entry_value(T.revised(r,k,j,U32.add(n,1),v,target)) : F32}
      {==}
    case False{}:
      %eq : {Bool.pick(F32,_,v,T.lookup(T.adjust(t,k,j,r,target),k,j)) ==
        T.entry_value(T.revised(r,k,j,U32.add(T.visits(t,k,j),1),T.lookup(t,k,j),target)) : F32}
      ih

def Laws.table_adjust_value(t,s,a,r,target):
  match t:
    case Nil{}:
      %Equal.sym(Bool,U32.is_eq(s,s) && U32.is_eq(a,a),True{},key_eq_self(s,a)) :
        {Bool.pick(F32,_,T.entry_value(T.revised(r,s,a,1,0.0,target)),0.0) == T.entry_value(T.revised(r,s,a,1,0.0,target)) : F32}
      {==}
    case T.Entry{+x,+y,n,v} <> +tail:
      adjust_value_cons(U32.is_eq(x,s) && U32.is_eq(y,a),x,y,n,v,tail,s,a,r,target,Laws.table_adjust_value(tail,s,a,r,target),{==})

def holds(b: Bool) -> Type:
  match b:
    case True{}: Unit
    case False{}: Empty

def impossible(e: {True{} == False{} : Bool}) -> Empty:
  %e : holds(_)
  Unit{}

def absurd(-A: Type,e: Empty) -> A:
  match e:

def bits_equal(a: Bool,b: Bool,e: {Cmp.is_eq(Bool.cmp(a,b)) == True{} : Bool}) -> {a == b : Bool}:
  match a b:
    case False{} False{}: {==}
    case True{} True{}: {==}
    case False{} True{}:
      absurd({False{} == True{} : Bool},impossible(Equal.sym(Bool,False{},True{},e)))
    case True{} False{}:
      absurd({True{} == False{} : Bool},impossible(Equal.sym(Bool,False{},True{},e)))

def fin_tail(a: Bool,b: Bool,c: Cmp,e: {Cmp.is_eq(Word.cmp.fin(a,b,c)) == True{} : Bool}) -> {Cmp.is_eq(c) == True{} : Bool}:
  match c:
    case EQ{}: {==}
    case LT{}: e
    case GT{}: e

def fin_head(a: Bool,b: Bool,c: Cmp,e: {Cmp.is_eq(Word.cmp.fin(a,b,c)) == True{} : Bool}) -> {a == b : Bool}:
  match c:
    case EQ{}: bits_equal(a,b,e)
    case LT{}:
      absurd({a == b : Bool},impossible(Equal.sym(Bool,False{},True{},e)))
    case GT{}:
      absurd({a == b : Bool},impossible(Equal.sym(Bool,False{},True{},e)))

def word_equal(n: Nat,x: Word(n),y: Word(n),e: {Cmp.is_eq(Word.cmp(n,x,y)) == True{} : Bool}) -> {x == y : Word(n)}:
  match n:
    case 0n:
      match x y:
        case WNil{} WNil{}: {==}
    case 1n++p:
      match x y:
        case WCon{False{},+t} WCon{False{},+u}:
          Equal.cong(Word(p),Word(1n+p),v => WCon{False{},v},t,u,word_equal(p,t,u,fin_tail(False{},False{},Word.cmp(p,t,u),e)))
        case WCon{True{},+t} WCon{True{},+u}:
          Equal.cong(Word(p),Word(1n+p),v => WCon{True{},v},t,u,word_equal(p,t,u,fin_tail(True{},True{},Word.cmp(p,t,u),e)))
        case WCon{True{},t} WCon{False{},u}:
          absurd({WCon{True{},t} == WCon{False{},u} : Word(1n+p)},impossible(fin_head(True{},False{},Word.cmp(p,t,u),e)))
        case WCon{False{},t} WCon{True{},u}:
          absurd({WCon{False{},t} == WCon{True{},u} : Word(1n+p)},impossible(Equal.sym(Bool,False{},True{},fin_head(False{},True{},Word.cmp(p,t,u),e))))

def id_equal(x: U32,y: U32,e: {U32.is_eq(x,y) == True{} : Bool}) -> {x == y : U32}:
  match x y:
    case U32{a} U32{b}: Equal.cong(Word(32n),U32,w => U32{w},a,b,word_equal(32n,a,b,e))

def key_test(s: U32,a: U32,q: U32,j: U32) -> Bool:
  U32.is_eq(s,q) && U32.is_eq(a,j)

def transfer_distinct(b: Bool,c: Bool,s: U32,a: U32,k: U32,l: U32,q: U32,j: U32,
  es: {U32.is_eq(s,k) == b : Bool}, ea: {U32.is_eq(a,l) == c : Bool},
  hit: {b && c == True{} : Bool}, distinct: {key_test(k,l,q,j) == False{} : Bool}) ->
  {key_test(s,a,q,j) == False{} : Bool}:
  match b c:
    case True{} True{}:
      %Equal.sym(U32,s,k,id_equal(s,k,es)) : {key_test(_,a,q,j) == False{} : Bool}
      %Equal.sym(U32,a,l,id_equal(a,l,ea)) : {key_test(k,_,q,j) == False{} : Bool}
      distinct
    case True{} False{}:
      absurd({key_test(s,a,q,j) == False{} : Bool},impossible(Equal.sym(Bool,False{},True{},hit)))
    case False{} _:
      absurd({key_test(s,a,q,j) == False{} : Bool},impossible(Equal.sym(Bool,False{},True{},hit)))

def other_lookup_cons(b: Bool,+s: U32,+a: U32,n: U32,v: F32,t: T.Table,+k: U32,+l: U32,r: T.Rate,target: F32,+q: U32,+j: U32,
  same: {key_test(s,a,k,l) == b : Bool}, distinct: {key_test(k,l,q,j) == False{} : Bool},
  ih: {key_test(k,l,q,j) == False{} : Bool} -> {T.lookup(T.adjust(t,k,l,r,target),q,j) == T.lookup(t,q,j) : F32}) ->
  {T.lookup(T.replace_or_keep(b,u => T.revised(r,s,a,U32.add(n,1),v,target) <> t,
     u => T.Entry{s,a,n,v} <> T.adjust(t,k,l,r,target)),q,j) == T.lookup(T.Entry{s,a,n,v} <> t,q,j) : F32}:
  match b:
    case True{}:
      miss = transfer_distinct(U32.is_eq(s,k),U32.is_eq(a,l),s,a,k,l,q,j,{==},{==},same,distinct)
      %Equal.sym(Bool,key_test(s,a,q,j),False{},miss) :
        {Bool.pick(F32,_,T.entry_value(T.revised(r,s,a,U32.add(n,1),v,target)),T.lookup(t,q,j)) == Bool.pick(F32,_,v,T.lookup(t,q,j)) : F32}
      {==}
    case False{}:
      Equal.cong(F32,F32,x => Bool.pick(F32,key_test(s,a,q,j),v,x),T.lookup(T.adjust(t,k,l,r,target),q,j),T.lookup(t,q,j),ih(distinct))

def Laws.table_adjust_preserves_other_lookup(t,k,l,r,target,q,j,distinct):
  match t:
    case Nil{}:
      %Equal.sym(Bool,key_test(k,l,q,j),False{},distinct) : {Bool.pick(F32,_,T.entry_value(T.revised(r,k,l,1,0.0,target)),0.0) == 0.0 : F32}
      {==}
    case T.Entry{+s,+a,n,v} <> +tail:
      other_lookup_cons(key_test(s,a,k,l),s,a,n,v,tail,k,l,r,target,q,j,{==},distinct,
        d => Laws.table_adjust_preserves_other_lookup(tail,k,l,r,target,q,j,d))

def other_visits_cons(b: Bool,+s: U32,+a: U32,n: U32,v: F32,t: T.Table,+k: U32,+l: U32,r: T.Rate,target: F32,+q: U32,+j: U32,
  same: {key_test(s,a,k,l) == b : Bool}, distinct: {key_test(k,l,q,j) == False{} : Bool},
  ih: {key_test(k,l,q,j) == False{} : Bool} -> {T.visits(T.adjust(t,k,l,r,target),q,j) == T.visits(t,q,j) : U32}) ->
  {T.visits(T.replace_or_keep(b,u => T.revised(r,s,a,U32.add(n,1),v,target) <> t,
     u => T.Entry{s,a,n,v} <> T.adjust(t,k,l,r,target)),q,j) == T.visits(T.Entry{s,a,n,v} <> t,q,j) : U32}:
  match b:
    case True{}:
      miss = transfer_distinct(U32.is_eq(s,k),U32.is_eq(a,l),s,a,k,l,q,j,{==},{==},same,distinct)
      %Equal.sym(Bool,key_test(s,a,q,j),False{},miss) :
        {Bool.pick(U32,_,U32.add(n,1),T.visits(t,q,j)) == Bool.pick(U32,_,n,T.visits(t,q,j)) : U32}
      {==}
    case False{}:
      Equal.cong(U32,U32,x => Bool.pick(U32,key_test(s,a,q,j),n,x),T.visits(T.adjust(t,k,l,r,target),q,j),T.visits(t,q,j),ih(distinct))

def Laws.table_adjust_preserves_other_visits(t,k,l,r,target,q,j,distinct):
  match t:
    case Nil{}:
      %Equal.sym(Bool,key_test(k,l,q,j),False{},distinct) : {Bool.pick(U32,_,1,0) == 0 : U32}
      {==}
    case T.Entry{+s,+a,n,v} <> +tail:
      other_visits_cons(key_test(s,a,k,l),s,a,n,v,tail,k,l,r,target,q,j,{==},distinct,
        d => Laws.table_adjust_preserves_other_visits(tail,k,l,r,target,q,j,d))
