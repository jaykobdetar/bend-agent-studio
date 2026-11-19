import Base
import ./laws.bend as L
import ./agent.bend as N

def L.terminal_flush(s,b,q,n,a,g): {==}
def L.truncated_empty(s,xs,b,q,n,a,g): {==}
def L.finish_empty(m,reason):
  match m:
    case N.Agent{q,b,N.Config{n,a,g}}: {==}
