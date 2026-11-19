import Base
import ./engine.bend as E
import ./mountain_car.bend as Car
import ./tabular.bend as T
import ./weights.bend as W

type Method is Data:
  RandomCar{}
  CoarseQ{}
  TileQ{}
  TileExpected{}

type Settings is Data:
  TileSettings{method: Method, alpha: F32, gamma: F32, exploration: U32}

type Model is Data:
  Linear{settings: Settings, weights: W.Tree}

def initial(settings: Settings) -> Model: Linear{settings, W.Vacant{}}

def tilings(method: Method) -> Nat:
  match method:
    case CoarseQ{}: 1n
    case _: 8n

def tile_coordinate(scaled: F32, offset: U32) -> U32:
  U32.min(8, F32.to_u32(F32.floor(F32.add(scaled, F32.div(U32.to_f32(offset), 8.0)))))

def active(count: Nat, +x: F32, +v: F32) -> List<&2, W.Path>:
  match count:
    case 0n: Nil{}
    case 1n++rest:
      +i = U32.from_nat(rest)
      ix = tile_coordinate(x, i)
      iv = tile_coordinate(v, U32.mod(U32.mul(3, i), 8))
      key = U32.add(U32.mul(81, i), U32.add(U32.mul(9, ix), iv))
      W.address(10n, key) <> active(rest, x, v)

def features(method: Method, state: Car.State) -> List<&2, W.Path>:
  Car.Car{x, v} = state
  sx = F32.mul(F32.div(F32.add(x, 1.2), 1.8), 8.0)
  sv = F32.mul(F32.div(F32.add(v, 0.07), 0.14), 8.0)
  active(tilings(method), sx, sv)

def values(paths: List<&2, W.Path>, +tree: W.Tree) -> W.Row:
  match paths:
    case Nil{}: W.Weights{0.0, 0.0, 0.0}
    case path <> rest: W.plus(W.read(path, tree), values(rest, tree))

def choices(actions: List<&2, U32>, +row: W.Row) -> T.Choices:
  match actions:
    case Nil{}: T.NoChoices{}
    case +a <> rest: T.consider(a, W.action_value(row, a), choices(rest, row))

def greedy(model: Model, state: Car.State, actions: List<&2, U32>) -> U32:
  Linear{TileSettings{method, a, g, e}, weights} = model
  T.best_action(choices(actions, values(features(method, state), weights)))

def select(explore: Bool, model: Model, state: Car.State, actions: List<&2, U32>, word: U32) -> U32:
  match explore:
    case True{}: T.random_action(actions, word)
    case False{}: greedy(model, state, actions)

def training(mode: E.Mode) -> Bool:
  match mode:
    case E.Train{}: True{}
    case E.Evaluate{}: False{}

def act(model: Model, state: Car.State, actions: List<&2, U32>, mode: E.Mode, word: U32) -> U32:
  match model:
    case Linear{TileSettings{RandomCar{}, a, g, e}, weights}: T.random_action(actions, word)
    case Linear{TileSettings{method, a, g, +e}, weights}:
      +bits = word
      explore = training(mode) && U32.is_lt(U32.and(bits, 65535), e)
      select(explore, Linear{TileSettings{method, a, g, e}, weights}, state, actions,
             E.mix_word(U32.xor(bits, 2654435769)))

def backup(method: Method, buckets: U32, options: T.Choices) -> F32:
  match method options:
    case _ T.NoChoices{}: 0.0
    case TileExpected{} T.Choices{a, maximum, sum, count}:
      +eps = F32.div(U32.to_f32(buckets), 65536.0)
      F32.add(F32.mul(F32.sub(1.0, eps), maximum), F32.mul(eps, F32.div(sum, U32.to_f32(count))))
    case _ T.Choices{a, maximum, sum, count}: maximum

def future(+method: Method, buckets: U32, tree: W.Tree, view: E.View<Car.State>) -> F32:
  match view:
    case E.End{obs}: 0.0
    case E.Open{state, actions}:
      backup(method, buckets, choices(actions, values(features(method, state), tree)))

def apply(paths: List<&2, W.Path>, +tree: W.Tree, +action: U32, +delta: F32) -> W.Tree:
  match paths:
    case Nil{}: tree
    case +path <> rest:
      row = W.add_action(W.read(path, tree), action, delta)
      apply(rest, W.put(path, tree, row), action, delta)

def update(+method: Method, +alpha: F32, +gamma: F32, +buckets: U32, +tree: W.Tree,
           event: E.Transition<Car.State>) -> Model:
  E.Transition{state, +action, reward, next, truncated} = event
  +paths = features(method, state)
  prediction = W.action_value(values(paths, tree), action)
  target = F32.add(reward, F32.mul(gamma, future(method, buckets, tree, next)))
  delta = F32.mul(F32.div(alpha, F32.from_nat(tilings(method))), F32.sub(target, prediction))
  Linear{TileSettings{method, alpha, gamma, buckets}, apply(paths, tree, action, delta)}

def learn(model: Model, event: E.Transition<Car.State>) -> Model:
  match model:
    case Linear{TileSettings{RandomCar{}, a, g, e}, weights}:
      Linear{TileSettings{RandomCar{}, a, g, e}, weights}
    case Linear{TileSettings{m, a, g, e}, weights}: update(m, a, g, e, weights, event)

def episode(mode: E.Mode, model: Model, seed: U32, limit: Nat) -> E.Report<Model>:
  E.episode(~Car.State, ~Car.State, ~Model, ~E.Hooks{Car.world(), act, learn}, mode, model, seed, limit)
