import Base
import ../core/engine.bend as E
import ../core/tabular.bend as T
import ../core/study.bend as Study
import ../core/dyna.bend as Dyna
import ../core/double_q.bend as DQ
import ../core/tile_control.bend as Tile
import ../core/mountain_car.bend as Car
import ../core/arena.bend as Arena
import ../core/arena_table.bend as Store
import ../agents/lib/linear.bend as L
import ../agents/self_play/agent.bend as Player
import ../agents/ucb/agent.bend as UCB

def table(a: F32,b: F32,c: F32) -> T.Table:
  [T.Entry{4,71,1,a},T.Entry{4,11,1,b},T.Entry{4,19,1,c}]

def domain() -> Data: List<&2,U32>

def legal() -> domain: [71,11,19]

def sample(a: F32,b: F32,c: F32,word: U32) -> U32:
  T.sampled_table(table(a,b,c),4,legal(),word)

def training_epsilon(a: F32,b: F32,c: F32,word: U32) -> U32:
  T.epsilon_greedy(table(a,b,c),4,legal(),E.Train{},word)

def evaluate(a: F32,b: F32,c: F32,word: U32) -> U32:
  T.epsilon_greedy(table(a,b,c),4,legal(),E.Evaluate{},word)

def sample_empty(word: U32) -> U32: T.sampled_table([],4,[],word)

def sample_single(word: U32) -> U32: T.sampled_table([],4,[27],word)

def four_way(word: U32) -> U32:
  +q=table(4.0,4.0,4.0)
  T.sampled_table(T.Entry{4,5,1,3.999999761581421} <> q,4,[71,5,11,19],word)

def picks(+mode: E.Mode,+word: U32) -> domain:
  [Study.act(Study.Agent{Study.Settings{Study.QLearning{},0.25,1.0,0},[]},4,legal(),mode,word),
   Study.act(Study.PlanningAgent{Study.Settings{Study.DynaQ{5n},0.25,1.0,0},Dyna.Planner{[],[],0,31}},4,legal(),mode,word),
   Study.act(Study.DoubleAgent{Study.Settings{Study.DoubleQ{},0.25,1.0,0},DQ.Tables{[],[],91}},4,legal(),mode,word),
   Tile.act(Tile.initial(Tile.TileSettings{Tile.TileQ{},0.25,1.0,0}),Car.Car{0.0,0.0},[2,0,1],mode,word),
   L.act(~U32,~(x => [L.Feature{x,1.0}]),L.initial(L.Settings{0.25,1.0,0}),4,legal(),mode,word),
   Player.act(Player.Player{Player.Settings{Player.Negamax{},0.25,1.0,0},Store.Empty{},[]},Arena.Mover{False{},4},legal(),mode,word),
   UCB.act(UCB.UCB{table(0.0,0.0,0.0),1.41421356},4,legal(),mode,word)]

def training_paths(word: U32) -> domain: picks(E.Train{},word)
def evaluation_paths(word: U32) -> domain: picks(E.Evaluate{},word)
