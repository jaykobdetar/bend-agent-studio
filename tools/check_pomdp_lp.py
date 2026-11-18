"""Independent discounted fully observable check for the exporter's sparse syntax.
Requires SciPy; never use this state-aware LP as a partial-observation solver.
"""
import sys
from pathlib import Path
import numpy as np
from scipy.optimize import linprog

def solve(file):
    header, entries = {}, []
    for line in Path(file).read_text().splitlines():
        k,v=line.split(':',1)
        if k in ('T','O','R'): entries.append((k,v.replace(':',' ').split()))
        else: header[k]=v.split()
    s,a,o=(header[k] for k in ('states','actions','observations'))
    n=len(s); g=float(header['discount'][0])
    if not 0 <= g < 1: raise ValueError('discount must be below 1')
    t,r=np.zeros((2,len(a),n,n)); obs=np.zeros((len(a),n,len(o)))
    for k,parts in entries:
        ac,src,dst=parts[:3]; value=float(parts[-1])
        for i in range(len(a)) if ac=='*' else [a.index(ac)]:
            if k=='O': obs[i,s.index(src),o.index(dst)]=value
            else: (t if k=='T' else r)[i,s.index(src),s.index(dst)]=value
    if not np.allclose(t.sum(2),1) or not np.allclose(obs.sum(2),1): raise ValueError('invalid probability rows')
    if any(len(set(m.argmax(1)))!=n or not np.all(m.max(1)==1) for m in obs): raise ValueError('not fully observable')
    result=linprog(np.ones(n),A_ub=(g*t-np.eye(n)).reshape(-1,n),b_ub=-(t*r).sum(2).ravel(),bounds=(None,None),method='highs')
    if not result.success: raise ValueError(result.message)
    return np.dot(list(map(float,header['start'])),result.x)

if __name__=='__main__': print(solve(sys.argv[1]))
