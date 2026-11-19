import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {symbol} from '../core/finite_world.mjs';

// Bind display-only data to generated inputs, ignoring only Git checkout EOLs.
// The normalized world identifier also recognizes verified replays without their source path.
export function knownGridLayouts(root) {
  const layouts = new Map();
  for (const pack of ['toy-text', 'probes']) {
    const dir = path.join(root, 'worlds', 'benchmarks', pack);
    try {
      const index = JSON.parse(fs.readFileSync(path.join(dir, 'layouts.json'), 'utf8'));
      for (const [name, {sha256, ...layout}] of Object.entries(index)) {
        if (!/^[\w-]+\.json$/.test(name)) continue;
        try {
          const text = fs.readFileSync(path.join(dir, name), 'utf8').replaceAll('\r\n', '\n');
          if (createHash('sha256').update(text).digest('hex') === sha256)
            layouts.set(symbol(JSON.parse(text)), layout);
        } catch {
          /* Older or incomplete checkouts can omit display metadata. */
        }
      }
    } catch {
      /* Layout sidecars are optional. */
    }
  }
  return layouts;
}
