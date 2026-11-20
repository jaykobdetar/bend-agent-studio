import Base
import ./engine.bend as E
import ./tabular.bend as T
import ./doors.bend as Doors
import ./orchard.bend as Orchard
import ./cliff.bend as Cliff
import ./key_maze.bend as Maze
import ./ferry.bend as Ferry
import ./double_q.bend as DQ
import ./dyna.bend as Dyna
import ./tile_control.bend as Tile
import ./mountain_car.bend as Car
import ./cartpole.bend as Pole
import ./actor_critic.bend as AC
import ./noisy_fork.bend as Fork

type Game is Data:
  DoorsGame{}
  OrchardGame{}
  CliffGame{}
  MazeGame{}
  FerryGame{}
  NoisyForkGame{}

type Method is Data:
  Uniform{}
  MeanReward{}
  QLearning{}
  ExpectedSarsa{}
  DoubleQ{}
  DynaQ{planning: Nat}

# exploration is the number of exploring buckets out of 65536.
type Settings is Data:
  Settings{method: Method, alpha: F32, gamma: F32, exploration: U32}

type Model is Data:
  Agent{settings: Settings, values: T.Table}
  DoubleAgent{settings: Settings, tables: DQ.Tables}
  PlanningAgent{settings: Settings, state: Dyna.State}

def initial_for(settings: Settings, seed: U32) -> Model:
  match settings:
    case Settings{DynaQ{p}, a, g, e}:
      PlanningAgent{Settings{DynaQ{p}, a, g, e}, Dyna.Planner{[],[],0,E.mix_word(U32.xor(seed,1274126177))}}
    case Settings{DoubleQ{}, a, g, e}:
      DoubleAgent{Settings{DoubleQ{}, a, g, e}, DQ.Tables{Nil{}, Nil{}, E.mix_word(U32.xor(seed, 374761393))}}
    case other: Agent{other, Nil{}}

def initial(settings: Settings) -> Model: initial_for(settings, 0)

def probability(buckets: U32) -> F32:
  F32.div(U32.to_f32(buckets), 65536.0)

def explores(mode: E.Mode, buckets: U32, word: U32) -> Bool:
  match mode:
    case E.Evaluate{}: False{}
    case E.Train{}: U32.is_lt(U32.and(word, 65535), buckets)

def select(explore: Bool, table: T.Table, obs: U32, actions: List<&2, U32>, word: U32) -> U32:
  match explore:
    case False{}: T.sampled_table(table,obs,actions,word)
    case True{}: T.random_action(actions,E.mix_word(U32.xor(word,2654435769)))

def select_double(explore: Bool, tables: DQ.Tables, obs: U32, actions: List<&2, U32>, word: U32) -> U32:
  match explore:
    case True{}: T.random_action(actions,E.mix_word(U32.xor(word,2654435769)))
    case False{}: DQ.sampled_best(tables,obs,actions,word)

def train_table(buckets: U32,table: T.Table,obs: U32,actions: List<&2,U32>,+word: U32) -> U32:
  select(explores(E.Train{},buckets,word),table,obs,actions,word)

def train_double(buckets: U32,tables: DQ.Tables,obs: U32,actions: List<&2,U32>,+word: U32) -> U32:
  select_double(explores(E.Train{},buckets,word),tables,obs,actions,word)

def act(model: Model, obs: U32, actions: List<&2, U32>, mode: E.Mode, word: U32) -> U32:
  match model mode:
    case PlanningAgent{Settings{method,a,g,e},state} E.Train{}:
      train_table(e,Dyna.values(state),obs,actions,word)
    case PlanningAgent{cfg,state} E.Evaluate{}: T.best_action(T.choices(actions,Dyna.values(state),obs))
    case DoubleAgent{Settings{method,a,g,e},tables} E.Train{}:
      train_double(e,tables,obs,actions,word)
    case DoubleAgent{cfg,tables} E.Evaluate{}: DQ.best(tables,obs,actions)
    case Agent{Settings{Uniform{},alpha,gamma,buckets},values} _: T.random_action(actions,word)
    case Agent{Settings{method,alpha,gamma,buckets},values} E.Train{}:
      train_table(buckets,values,obs,actions,word)
    case Agent{cfg,values} E.Evaluate{}: T.best_action(T.choices(actions,values,obs))

def expected(+epsilon: F32, options: T.Choices) -> F32:
  match options:
    case T.NoChoices{}: 0.0
    case T.Choices{a, maximum, sum, count}:
      F32.add(F32.mul(F32.sub(1.0, epsilon), maximum), F32.mul(epsilon, F32.div(sum, U32.to_f32(count))))

def continuation(method: Method, buckets: U32, values: T.Table, view: E.View<U32>) -> F32:
  match method view:
    case _ E.End{obs}: 0.0
    case ExpectedSarsa{} E.Open{obs, actions}:
      expected(probability(buckets), T.choices(actions, values, obs))
    case _ E.Open{obs, actions}:
      T.option_value(T.Greedy{}, T.choices(actions, values, obs))

def td(+method: Method, +alpha: F32, +gamma: F32, +buckets: U32, +values: T.Table,
       event: E.Transition<U32>) -> Model:
  E.Transition{obs, action, reward, next, truncated} = event
  target = F32.add(reward, F32.mul(gamma, continuation(method, buckets, values, next)))
  Agent{Settings{method, alpha, gamma, buckets}, T.adjust(values, obs, action, T.Fixed{alpha}, target)}

def learn(model: Model, event: E.Transition<U32>) -> Model:
  match model:
    case PlanningAgent{Settings{DynaQ{+p}, +a, +g, e}, state}:
      PlanningAgent{Settings{DynaQ{p},a,g,e},Dyna.learn(p,state,a,g,event)}
    case PlanningAgent{cfg, state}: PlanningAgent{cfg,state}
    case DoubleAgent{Settings{method, +a, +g, e}, tables}:
      DoubleAgent{Settings{method, a, g, e}, DQ.learn(tables, a, g, event)}
    case Agent{Settings{Uniform{}, a, g, e}, values}:
      Agent{Settings{Uniform{}, a, g, e}, values}
    case Agent{Settings{MeanReward{}, a, g, e}, values}:
      Agent{Settings{MeanReward{}, a, g, e}, T.bandit(values, event)}
    case Agent{Settings{method, a, g, e}, values}:
      td(method, a, g, e, values, event)

def play(~S: Data, ~world: E.World<S, U32>, mode: E.Mode, model: Model, seed: U32, limit: Nat) -> E.Report<Model>:
  E.episode(~S, ~U32, ~Model, ~E.Hooks{world, act, learn}, mode, model, seed, limit)

def fold_game(~A: Data, ~observer: A -> U32 -> List<&2, U32> -> U32 -> Maybe<&2, E.Transition<U32>> -> A,
              game: Game, mode: E.Mode, model: Model, seed: U32, limit: Nat, record: A) -> E.Observed<A, Model>:
  match game:
    case DoorsGame{}: E.fold_episode(~Doors.Hall, ~U32, ~Model, ~E.Hooks{Doors.world(), act, learn}, ~A, ~observer, mode, model, seed, limit, record)
    case OrchardGame{}: E.fold_episode(~Bool, ~U32, ~Model, ~E.Hooks{Orchard.world(), act, learn}, ~A, ~observer, mode, model, seed, limit, record)
    case CliffGame{}: E.fold_episode(~U32, ~U32, ~Model, ~E.Hooks{Cliff.world(), act, learn}, ~A, ~observer, mode, model, seed, limit, record)
    case MazeGame{}: E.fold_episode(~Maze.State, ~U32, ~Model, ~E.Hooks{Maze.world(), act, learn}, ~A, ~observer, mode, model, seed, limit, record)
    case FerryGame{}: E.fold_episode(~Ferry.Stage, ~U32, ~Model, ~E.Hooks{Ferry.world(), act, learn}, ~A, ~observer, mode, model, seed, limit, record)
    case NoisyForkGame{}: E.fold_episode(~Fork.State, ~U32, ~Model, ~E.Hooks{Fork.world(), act, learn}, ~A, ~observer, mode, model, seed, limit, record)

def episode(game: Game, mode: E.Mode, model: Model, seed: U32, limit: Nat) -> E.Report<Model>:
  E.report_of(Unit, Model, fold_game(~Unit, ~(r => o => acts => a => ev => r), game, mode, model, seed, limit, Unit{}))

def trace_game(game: Game, mode: E.Mode, model: Model, seed: U32, limit: Nat) -> E.Observed<List<&2, E.Frame<U32>>, Model>:
  E.chronological(U32, Model, fold_game(~List<&2, E.Frame<U32>>, ~E.remember(U32), game, mode, model, seed, limit, []))

# Typed entry points for continuous observations use the same episode engine.
def car_initial(settings: Tile.Settings) -> Tile.Model: Tile.initial(settings)

def car_episode(mode: E.Mode, model: Tile.Model, seed: U32, limit: Nat) -> E.Report<Tile.Model>:
  Tile.episode(mode, model, seed, limit)

def car_trace(mode: E.Mode, model: Tile.Model, seed: U32, limit: Nat) -> E.Observed<List<&2, E.Frame<Car.State>>, Tile.Model>:
  E.trace(~Car.State, ~Car.State, ~Tile.Model, ~E.Hooks{Car.world(), Tile.act, Tile.learn}, mode, model, seed, limit)

def pole_initial(settings: AC.Settings, seed: U32) -> AC.Model: AC.initial(settings,seed)

def pole_episode(mode: E.Mode, model: AC.Model, seed: U32, limit: Nat) -> E.Report<AC.Model>:
  AC.episode(mode,model,seed,limit)

def pole_trace(mode: E.Mode, model: AC.Model, seed: U32, limit: Nat) -> E.Observed<List<&2,E.Frame<Pole.State>>,AC.Model>:
  E.trace(~Pole.State,~Pole.State,~AC.Model,~E.Hooks{Pole.world(),AC.act,AC.learn},mode,model,seed,limit)
