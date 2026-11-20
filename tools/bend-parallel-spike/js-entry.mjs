import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
function list(a, fn) {
  const ret = [];
  for (; a.$ === 'Con'; a = a.tail) ret.push(fn(a.head));
  assert.equal(a.$, 'Nil');
  return ret;
}
const [backend, arm, mode] = process.argv.slice(2);
const a = Number(arm);
const x = (await import(pathToFileURL(path.resolve(backend)))).default;
assert([0, 1].includes(a) && ['serial', 'parallel'].includes(mode));
const result = mode === 'serial' ? x.serial(8, 0, a) : x.fork(3, 0, 8, a);
console.log(JSON.stringify(list(result, (l) => list(l, (n) => n))));
