"""Fixed CLI adapter for the existing learning_curves implementation."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analyze import read_rows
from plot_curves import learning_curves, main
csv, phase, metric, ref, draws, *svg = sys.argv[1:]
if svg:
    sys.argv = [sys.argv[0], csv, svg[0], '--phase', phase, '--metric', metric,
                '--draws', draws] + (['--reference=' + ref] if ref else [])
    main()
else:
    series = learning_curves(read_rows(csv), phase, metric, ref or None, None, None, int(draws))
    print(json.dumps({'series': [{'game': g, 'arm': a, 'points': [
        {'budget': n, 'estimate': v, 'interval': [None if q == '' else q for q in (lo, hi)]}
        for n, v, lo, hi in points]} for (g, a), points in series.items()]}))
