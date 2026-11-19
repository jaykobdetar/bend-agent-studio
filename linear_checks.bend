import Base
import ./agents/lib/linear.bend as L
import ./core/engine.bend as E
import ./core/weights.bend as W
import ./core/tabular.bend as T

def real_features(x: F32) -> L.Features:
  [L.Feature{0,1.0},L.Feature{4294967295,x}]

def predicted(model: L.Model,action: U32) -> F32:
  L.dot(real_features(2.0),L.weights(model),action)

def check(label: String,ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("pass - " ++ label)
    case False{}: IO.die(Unit,1,"failed - " ++ label)

def main() -> IO(Unit):
  +tree=L.put(L.put(W.Vacant{},7,1,3.0),9,0,4.0)
  +features={[L.Feature{1,2.0},L.Feature{1,F32.sub(0.0,1.0)}] : L.Features}
  +initial={L.Linear{L.Settings{0.5,0.5,65536},tree} : L.Model}
  +terminal=L.learn(~F32,~real_features,initial,E.Transition{2.0,19,2.0,E.End{3.0},False{}})
  +cut=L.learn(~F32,~real_features,initial,E.Transition{2.0,19,2.0,E.Open{3.0,[9]},True{}})
  +open=L.learn(~F32,~real_features,initial,E.Transition{2.0,19,2.0,E.Open{3.0,[9]},False{}})
  +full=L.put(L.put(W.Vacant{},4294967295,4294967295,7.0),0,0,8.0)
  do IO<Unit>:
    check("signed repeated features sum rather than deduplicate",F32.is_eq(L.dot(features,tree,7),3.0))
    check("repeated gradients accumulate in authored order",F32.is_eq(L.weight(L.apply(features,tree,7,0.5),7,1),3.5))
    check("zero features have zero value and no update",F32.is_eq(L.dot([],tree,7),0.0) && F32.is_eq(L.weight(L.apply([],tree,7,1.0),7,1),3.0))
    check("full-width action and feature addresses do not alias zero",F32.is_eq(L.weight(full,4294967295,4294967295),7.0) && F32.is_eq(L.weight(full,0,0),8.0) && F32.is_eq(L.weight(full,0,4294967295),0.0))
    check("generic real observation terminal target has no bootstrap",F32.is_eq(predicted(terminal,19),5.0))
    check("truncation bootstraps exactly as an open transition",F32.is_eq(predicted(cut,19),10.0) && F32.is_eq(predicted(open,19),10.0))
    check("update changes only chosen action weights",F32.is_eq(L.weight(L.weights(cut),7,1),3.0) && F32.is_eq(L.weight(L.weights(cut),9,0),4.0))
    check("legal-order ties choose first arbitrary ID",U32.is_eq(T.best_action(L.choices([71,9],[],tree)),71))
    check("evaluation ignores full exploration setting",U32.is_eq(L.act(~F32,~real_features,initial,2.0,[7,9],E.Evaluate{},0),9))
    check("illegal high-value action excluded",U32.is_eq(L.act(~F32,~real_features,initial,2.0,[19,7],E.Evaluate{},0),19))
