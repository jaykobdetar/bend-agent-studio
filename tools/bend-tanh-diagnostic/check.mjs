import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [file, root, out] = process.argv.slice(2);
const f = (await import(pathToFileURL(file).href)).default.tanh_portable;
assert.equal(typeof f, 'function');
const source = readFileSync(join(root, 'words.txt'));
const corpusId = createHash('sha256').update(source).digest('hex');
assert.equal(corpusId, 'a7215fc26468e629a0c072e9520faba7ffe32efec6d3236e8d493b995cc633d9');
const input = source.toString().trim().split('\n');
const references = ['interval.txt', 'target.txt'].map((name) =>
  readFileSync(join(root, name), 'utf8').trim().split('\n'),
);
assert.equal(input.length, 5692);
assert.equal(new Set(input).size, input.length);
assert(references.every((a) => a.length === input.length));
const counts = {centerAgree: 0, centerUndecided: 0, ordinaryBoundary: 0, nanPolicy: 0};
const witness = [];
const bad = [];
const unresolved = [];
for (const [i, h] of input.entries()) {
  assert.match(h, /^[0-9a-f]{8}$/);
  const [word1, mpfr1] = references[0][i].split(' ');
  const [word2, mpfr2] = references[1][i].split(' ');
  assert.equal(h, word1);
  assert.equal(h, word2);
  assert.equal(mpfr1, mpfr2);
  const word = Number.parseInt(h, 16),
    mag = word & 0x7fffffff;
  const tag =
    mag > 0x7f800000 ? 'nan' : mag > 0x39800000 && mag < 0x41200000 ? 'center' : 'boundary';
  assert.equal(tag === 'nan', mpfr1 === 'nan');
  const x = f(word);
  if (x.$ === 'None') {
    witness.push(h + ' None');
    if (tag === 'center') {
      counts.centerUndecided++;
      unresolved.push(h);
    } else bad.push({input: h, got: 'None', expected: mpfr1});
    continue;
  }
  assert.equal(x.$, 'Some');
  assert(Number.isInteger(x.value) && x.value >= 0 && x.value <= 0xffffffff);
  const actual = x.value.toString(16).padStart(8, '0');
  const expected = tag === 'nan' ? '7fc00000' : mpfr1;
  witness.push(h + ' ' + actual);
  if (actual !== expected) bad.push({input: h, got: actual, expected});
  counts[tag === 'center' ? 'centerAgree' : tag === 'nan' ? 'nanPolicy' : 'ordinaryBoundary']++;
}
assert.equal(counts.centerAgree + counts.centerUndecided, 4110);
assert.equal(counts.ordinaryBoundary, 1058);
assert.equal(counts.nanPolicy, 524);
const data = witness.join('\n') + '\n';
writeFileSync(join(out, 'witness.txt'), data, {flag: 'wx'});
console.log(
  JSON.stringify(
    {
      scope: 'partial portable Bend sample, emitted JS only',
      corpusId,
      inputCount: input.length,
      counts,
      mismatches: bad.length,
      firstMismatches: bad.slice(0, 8),
      unresolved,
      outputSha256: createHash('sha256').update(data).digest('hex'),
    },
    null,
    2,
  ),
);
if (bad.length || counts.centerAgree === 0) process.exitCode = 1;
