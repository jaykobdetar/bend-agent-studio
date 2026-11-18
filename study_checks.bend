import Base
import ./checks.bend as Check
import ./engine.bend as E
import ./tabular.bend as T
import ./double_q.bend as Double
import ./dyna.bend as D
import ./mountain_car.bend as Car
import ./tile_control.bend as Tile
import ./weights.bend as W
import ./cartpole.bend as Pole
import ./actor_critic.bend as AC
import ./offline.bend as Offline
import ./logged.bend as Log

def near(x: F32, y: F32, tolerance: F32) -> Bool:
  F32.is_le(F32.abs(F32.sub(x,y)),tolerance)

def double_check() -> Bool:
  left={[T.Entry{5,10,1,9.0},T.Entry{5,12,1,8.0}] : T.Table}
  right={[T.Entry{5,10,1,1.0},T.Entry{5,12,1,7.0},T.Entry{5,99,1,100.0}] : T.Table}
  F32.is_eq(Double.continuation(left,right,E.Open{5,[10,12]}),1.0)

def empiric() -> D.LearnedModel:
  b1=Offline.observe(Offline.empty(),E.Transition{1,9,2.0,E.End{2},False{}})
  b2=Offline.observe(b1,E.Transition{1,9,4.0,E.End{2},False{}})
  Offline.observe(b2,E.Transition{1,9,0.0,E.Open{3,[6]},True{}})

def empirical_check(batch: D.LearnedModel) -> Bool:
  match batch:
    case D.LearnedModel{D.PairModel{1,9,3,D.Sample{E.End{2},2,r} <> D.Sample{E.Open{3,legal},1,next_r} <> Nil{}} <> Nil{},1}:
      F32.is_eq(r,3.0) && F32.is_eq(next_r,0.0)
    case _: False{}

def planning_check(batch: D.LearnedModel) -> Bool:
  D.LearnedModel{m,n}=batch
  q={[T.Entry{3,6,1,12.0}] : T.Table}
  updated=D.backup(q,1.0,0.5,List.get(&2,D.PairModel,m,0n))
  F32.is_eq(T.lookup(updated,1,9),4.0)

def car_wall(result: Pair(Car.State,F32)) -> Bool:
  (Car.Car{x,v},r)=result
  F32.is_eq(x,F32.neg(1.2)) && F32.is_eq(v,0.0) && F32.is_eq(r,F32.neg(1.0))

def tile_row_is(row: W.Row) -> Bool:
  W.Weights{l,c,r}=row
  F32.is_eq(l,0.0) && F32.is_eq(c,0.0) && F32.is_eq(r,2.0)

def tile_model_is(model: Tile.Model, s: Car.State) -> Bool:
  Tile.Linear{cfg,tree}=model
  tile_row_is(Tile.values(Tile.features(Tile.TileQ{},s),tree))

def tile_check() -> Bool:
  +s={Car.Car{F32.neg(0.5),0.0} : Car.State}
  event={E.Transition{s,2,4.0,E.End{s},False{}} : E.Transition<Car.State>}
  tile_model_is(Tile.learn(Tile.initial(Tile.TileSettings{Tile.TileQ{},0.5,1.0,8192}),event),s)

def pole_check(left: Pair(Pole.State,F32), right: Pair(Pole.State,F32)) -> Bool:
  (Pole.Cart{lx,lv,la,lw},lr)=left
  (Pole.Cart{rx,+rv,ra,+rw},rr)=right
  near(lv,F32.neg(rv),0.000001) && near(lw,F32.neg(rw),0.000001) &&
    F32.is_gt(rv,0.0) && F32.is_lt(rw,0.0) && F32.is_eq(lr,rr)

# Compare the actual direction of a hidden weight update to a central
# difference of the actor objective plus the critic's fixed-target gradient.
def example(input: F32) -> AC.Model:
  AC.Network{AC.ACSettings{AC.NetworkAC{},0.125,0.125,1.0},
    [AC.Neuron{AC.Vector{input,0.0,0.0,0.0},0.1,0.7,F32.neg(0.2)}],0.0,0.0}

def objective(result: AC.Outputs, delta: F32) -> F32:
  AC.Outputs{logit,value}=result
  F32.mul(delta,F32.add(F32.log(AC.sigmoid(logit)),value))

def first_input(model: AC.Model) -> F32:
  match model:
    case AC.Network{cfg,AC.Neuron{AC.Vector{x,v,t,w},b,a,c} <> rest,l,val}: x
    case _: 0.0

def gradient_check() -> Bool:
  +s={Pole.Cart{1.2,0.0,0.0,0.0} : Pole.State}
  +old=example(0.4)
  +delta=F32.sub(1.0,AC.value(AC.outputs(old,s)))
  updated=AC.learn(old,E.Transition{s,1,1.0,E.End{s},False{}})
  analytic=F32.div(F32.sub(first_input(updated),0.4),0.125)
  numeric=F32.div(F32.sub(objective(AC.outputs(example(0.401),s),delta),objective(AC.outputs(example(0.399),s),delta)),0.002)
  near(analytic,numeric,0.0001)

def offline_fixture() -> D.LearnedModel:
  b=Offline.observe(Offline.empty(),E.Transition{0,4,F32.neg(1.0),E.Open{1,[3,7]},False{}})
  Offline.observe(b,E.Transition{1,3,F32.neg(1.0),E.End{2},False{}})

def fitted_value(policy: Offline.Policy) -> F32:
  Offline.Policy{method,q,counts}=policy
  T.lookup(q,0,4)

def fqi_check() -> Bool:
  +batch=offline_fixture()
  one=Offline.fit(Offline.Supported{},batch,1n,1.0)
  two=Offline.fit(Offline.Supported{},batch,2n,1.0)
  F32.is_eq(fitted_value(one),F32.neg(1.0)) && F32.is_eq(fitted_value(two),F32.neg(2.0))

def support_check() -> Bool:
  +batch=offline_fixture()
  +legal={[4,9] : List<&2,U32>}
  unsupported=Offline.act(Offline.fit(Offline.Fitted{},batch,2n,1.0),0,legal,E.Evaluate{},0)
  supported=Offline.act(Offline.fit(Offline.Supported{},batch,2n,1.0),0,legal,E.Evaluate{},0)
  U32.is_eq(unsupported,9) && U32.is_eq(supported,4)

def sample_counts(n: Nat,+legal: List<&2,U32>,+buckets: U32,+a: U32,+total: U32) -> U32:
  match n:
    case 0n: total
    case 1n++rest:
      hit=Bool.to_u32(U32.is_eq(a,Log.choose(legal,30,buckets,U32.from_nat(rest))))
      sample_counts(rest,legal,buckets,a,U32.add(total,hit))

def logging_check() -> Bool:
  +legal={[5,30,99] : List<&2,U32>}
  U32.is_eq(sample_counts(65536n,legal,5000,5,0),Log.count(0,3,5000,False{})) &&
    U32.is_eq(sample_counts(65536n,legal,5000,30,0),Log.count(1,3,5000,True{})) &&
    U32.is_eq(sample_counts(65536n,legal,5000,99,0),Log.count(2,3,5000,False{}))

def main() -> IO(Unit):
  +pole={Pole.Cart{0.0,0.0,0.0,0.0} : Pole.State}
  do IO<Unit>:
    Check.check("Double Q selects with one estimator and evaluates with the other",double_check())
    Check.check("empirical model counts outcomes and averages conditional rewards",empirical_check(empiric()))
    Check.check("planning weights all distinct public outcomes by frequency",planning_check(empiric()))
    Check.check("Mountain Car clips the left wall and removes outward speed",car_wall(Car.step(Car.Car{F32.neg(1.2),F32.neg(0.07)},0,99)))
    Check.check("tile update distributes the specified learning rate over active features",tile_check())
    Check.check("CartPole forces produce mirrored accelerations and equal rewards",pole_check(Pole.step(pole,0,10),Pole.step(pole,1,20)))
    Check.check("shared neural hidden gradient agrees with a finite difference",gradient_check())
    Check.check("fitted Q uses synchronous previous-iteration targets",fqi_check())
    Check.check("support restriction removes zero-initialized unobserved actions",support_check())
    Check.check("all 65536 logging draws reproduce the recorded action propensities",logging_check())
