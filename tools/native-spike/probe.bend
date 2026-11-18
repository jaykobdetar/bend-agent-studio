import Base
import ../../engine.bend as E
import ../../actor_critic.bend as AC
import ../../tabular.bend as T
import ../../study.bend as S

# Compare raw F32 words, not formatted decimal strings or aggregate scores.
def stop(reason: E.Stop, tail: List<&2,U32>) -> List<&2,U32>:
  match reason:
    case E.Terminal{}: 0 <> 0 <> tail
    case E.Limit{}: 1 <> 0 <> tail
    case E.Illegal{action}: 2 <> action <> tail

def units(xs: List<&2,AC.UnitWeights>) -> List<&2,U32>:
  match xs:
    case Nil{}: []
    case AC.Neuron{AC.Vector{x,v,a,w},bias,actor,critic} <> tail:
      F32.bits(x) <> F32.bits(v) <> F32.bits(a) <> F32.bits(w) <>
        F32.bits(bias) <> F32.bits(actor) <> F32.bits(critic) <> units(tail)

def pole_method(m: AC.Method) -> U32:
  match m:
    case AC.NetworkAC{}: 2
    case AC.LinearAC{}: 1
    case AC.RandomPole{}: 0

def pole_words(report: E.Report<AC.Model>) -> List<&2,U32>:
  E.Report{AC.Network{AC.ACSettings{m,ar,cr,g},xs,lb,vb},score,steps,reason}=report
  F32.bits(score) <> U32.from_nat(steps) <> stop(reason,
    pole_method(m) <> F32.bits(ar) <> F32.bits(cr) <> F32.bits(g) <> F32.bits(lb) <> F32.bits(vb) <> units(xs))

# These are the shipped cartpole.json NetworkAC settings; start from a
# fresh model for the first actual training episode of the selected replicate.
def pole(+rep: U32) -> List<&2,U32>:
  +seed = U32.add(101000000,U32.mul(rep,200000))
  model = S.pole_initial(AC.ACSettings{AC.NetworkAC{},0.003,0.02,0.99},seed)
  pole_words(S.pole_episode(E.Train{},model,seed,500n))

def entries(xs: T.Table) -> List<&2,U32>:
  match xs:
    case Nil{}: []
    case T.Entry{s,a,visits,q} <> tail: s <> a <> visits <> F32.bits(q) <> entries(tail)

def agent_method(m: S.Method) -> U32:
  match m:
    case S.QLearning{}: 2
    case _: 4294967295

def q_words(report: E.Report<S.Model>) -> List<&2,U32>:
  match report:
    case E.Report{S.Agent{S.Settings{m,alpha,gamma,eps},xs},score,steps,reason}:
      F32.bits(score) <> U32.from_nat(steps) <> stop(reason,
        agent_method(m) <> F32.bits(alpha) <> F32.bits(gamma) <> eps <> entries(xs))
    case _: [4294967295]

def noisy(rep: U32) -> List<&2,U32>:
  +seed = U32.add(31000000,U32.mul(rep,10000))
  model = S.initial_for(S.Settings{S.QLearning{},0.1,1.0,6554},seed)
  q_words(S.episode(S.NoisyForkGame{},E.Train{},model,seed,2n))

def trained(report: E.Report<S.Model>) -> S.Model:
  E.Report{model,score,steps,reason} = report
  model

def noisy_last(extra: Nat, +seed: U32, model: S.Model) -> E.Report<S.Model>:
  match extra:
    case 0n: S.episode(S.NoisyForkGame{},E.Train{},model,seed,2n)
    case 1n+rest:
      prior = S.episode(S.NoisyForkGame{},E.Train{},model,seed,2n)
      noisy_last(rest,U32.add(seed,1),trained(prior))

def checkpoint(rep: U32) -> List<&2,U32>:
  +seed = U32.add(31000000,U32.mul(rep,10000))
  model = S.initial_for(S.Settings{S.QLearning{},0.1,1.0,6554},seed)
  q_words(noisy_last(1023n,seed,model))

def math_words(i: U32) -> List<&2,U32>:
  +x = F32.div(U32.to_f32(U32.add(i,1)),257.0)
  [F32.bits(F32.cos(x)),F32.bits(F32.tanh(x)),F32.bits(F32.sqrt(x)),F32.bits(F32.log(x))]

def row(+i: U32) -> List<&2,List<&2,U32>>:
  [noisy(i),pole(i),math_words(i),checkpoint(i)]

def words(xs: List<&2,U32>) -> String:
  List.show(~&2,~U32,~U32.show,xs)

# Separate stress domain, not a claim about values visited by the two plans.
def sweep(n: Nat, +idx: U32) -> List<&2,List<&2,U32>>:
  match n:
    case 0n: []
    case 1n+rest:
      +positive = F32.div(U32.to_f32(U32.add(idx,1)),171.0)
      +signed = F32.sub(positive,12.0)
      [F32.bits(F32.cos(signed)),F32.bits(F32.tanh(signed)),
       F32.bits(F32.sqrt(positive)),F32.bits(F32.log(positive))] <>
        sweep(rest,U32.add(idx,1))

def output(stress: Bool, i: U32) -> List<&2,List<&2,U32>>:
  match stress:
    case False{}: row(i)
    case True{}: sweep(64n,U32.mul(64,U32.sub(i,32)))

def run_arg(i: Maybe<&2,U32>) -> IO(Unit):
  match i:
    case Some{+rep}: IO.print(List.show(~&2,~List<&2,U32>,~words,output(U32.is_ge(rep,32),rep)))
    case None{}: IO.die(Unit,1,"expected an unsigned replicate number")

def argv(args: List<String>) -> IO(Unit):
  match args:
    case _ <> arg <> Nil{}: run_arg(U32.read(arg))
    case _: IO.die(Unit,1,"usage: probe REPLICATE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    argv(args)
