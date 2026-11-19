import Base
import ./core/tabular.bend as T
import ./agents/lib/linear.bend as L
import ./core/weights.bend as W
import ./core/engine.bend as E

law scalar_read_after_write:
  for tree: W.Tree
  for action: U32
  for feature: U32
  for value: F32
  {L.weight(L.put(tree,action,feature,value),action,feature) == value : F32}

law empty_features_preserve_weights:
  for tree: W.Tree
  for action: U32
  for rate: F32
  {L.apply([],tree,action,rate) == tree : W.Tree}

law terminal_has_no_bootstrap:
  for ~O: Data
  for ~features: O -> L.Features
  for tree: W.Tree
  for obs: O
  {L.future(~O,~features,tree,E.End{obs}) == 0.0 : F32}

law evaluation_chooses_greedily:
  for ~O: Data
  for ~features: O -> L.Features
  for alpha: F32
  for gamma: F32
  for exploration: U32
  for tree: W.Tree
  for obs: O
  for legal: List<&2,U32>
  for word: U32
  {L.act(~O,~features,L.Linear{L.Settings{alpha,gamma,exploration},tree},obs,legal,E.Evaluate{},word)
    == T.best_action(L.choices(legal,features(obs),tree)) : U32}
