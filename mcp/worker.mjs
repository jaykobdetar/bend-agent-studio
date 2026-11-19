import {numberPreservingJson} from '../core/finite_world.mjs';
import fs from 'node:fs';
import {context} from './context.mjs';
import {compute} from './authoring.mjs';
try {
  const [name, workspace, file] = process.argv.slice(2);
  const out = numberPreservingJson(
    compute(name, JSON.parse(fs.readFileSync(file)), context(workspace)),
  );
  if (Buffer.byteLength(out) > 2 ** 20) throw Error('result exceeds 1 MiB');
  process.stdout.write(out);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
