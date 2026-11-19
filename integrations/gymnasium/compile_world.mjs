// Normalize just once: do not duplicate grids, F32 rounding, or U32 bucket division in Python.
import fs from 'node:fs';
import {worldDefinition, buckets} from '../../core/finite_world.mjs';
try {
  const w=worldDefinition(JSON.parse(fs.readFileSync(0,'utf8')));
  const endpoints=xs=>buckets(xs).map(({probability,...entry})=>entry);
  w.initial=endpoints(w.initial);
  for(const s of w.states)for(const a of s.actions)a.outcomes=endpoints(a.outcomes);
  // Python parses JSON integer -0 as int(0); a decimal token preserves IEEE signed zero.
  process.stdout.write(JSON.stringify(w,(_k,v)=>Object.is(v,-0)?JSON.rawJSON("-0.0"):v));
} catch(e) {console.error(e.message);process.exitCode=1}
