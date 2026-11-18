import Base
import ./sarsa_laws.bend as L
import ./agents/sarsa.bend as S

def L.terminal_clears(s,p,q,alpha,gamma): {==}
def L.truncation_clears(s,actions,p,q,alpha,gamma): {==}
def L.finish_clears(m,reason):
  match m:
    case S.Agent{q,p,alpha,gamma}: {==}
