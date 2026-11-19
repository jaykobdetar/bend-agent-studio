import Base
import ./laws.bend as Laws
import ../lib/linear.bend as L
import ../../core/weights.bend as W

def read_put(path: W.Path,tree: W.Tree,row: W.Row) ->
  {W.read(path,W.put(path,tree,row)) == row : W.Row}:
  match path:
    case W.Here{}: {==}
    case W.Low{p}: read_put(p,W.low(tree),row)
    case W.High{p}: read_put(p,W.high(tree),row)

def Laws.scalar_read_after_write(tree,action,feature,value):
  Equal.cong(W.Row,F32,r => W.action_value(r,0),W.read(L.address(action,feature),W.put(L.address(action,feature),tree,W.Weights{value,0.0,0.0})),W.Weights{value,0.0,0.0},
    read_put(L.address(action,feature),tree,W.Weights{value,0.0,0.0}))
def Laws.empty_features_preserve_weights(tree,action,rate): {==}
def Laws.terminal_has_no_bootstrap(O,features,tree,obs): {==}
def Laws.evaluation_chooses_greedily(O,features,alpha,gamma,exploration,tree,obs,legal,word): {==}
