import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {existing, gameRunner, record, stats, unseal} from '../../core/experiment.mjs';
import {seedOf, settings} from '../../core/experiment_config.mjs';

const [archive, reference, arm, file, ...extras] = process.argv.slice(2);
assert(!extras.length && archive && reference && file && ['q_learning', 'dyna_q'].includes(arm));
assert(fs.statSync(reference).size <= 2 ** 23 && fs.statSync(file).size <= 2 ** 23);
const rows = JSON.parse(fs.readFileSync(reference, 'utf8')).rows.filter((r) => r.arm === arm);
assert.equal(rows.length, 32);
const manifest = unseal(path.join(archive, 'run.json'));
assert.equal(manifest.hash, 'a5b41470bbe999d26d9919087156c5b62078ecae52c634757addd29e5ea36a43');
const plan = manifest.body.plan;
const g = plan.games.find((g) => g.id === 'lake4-slip'),
  a = plan.arms.find((a) => a.id === arm);
const backend = path.join(archive, 'code/backend.mjs');
assert.equal(
  createHash('sha256').update(fs.readFileSync(backend)).digest('hex'),
  manifest.body.toolchain.backend,
);
const api = (await import(pathToFileURL(backend))).default;
const runner = gameRunner(api, g, a),
  training = {$: 'Train'},
  stop = {Terminal: 0, Limit: 1, Illegal: 2};
const bits = new DataView(new ArrayBuffer(4));
const expected = [];
for (let rep = 0; rep < 8; rep++) {
  const seed = seedOf(plan, rep, 'train');
  const acc = stats(),
    groups = [];
  let model = runner.initial(settings(a, g), seed),
    m = 0,
    prior = null;
  for (const b of plan.checkpoints) {
    if (b > 128) break;
    const ws = [];
    for (; m < b; m++) {
      const r = runner.episode(training, model, seed + m, g.limit);
      model = r.model;
      record(acc, r);
      bits.setFloat32(0, r.score);
      ws.push(bits.getUint32(0), r.steps, stop[r.reason.$], r.reason.action ?? 0);
    }
    const cp = existing(archive, manifest.hash, {game: g, arm: a, rep}, b, prior);
    assert.deepEqual(acc, cp.body.train);
    assert.deepEqual(model, cp.body.model);
    prior = cp.hash;
    if (b !== 0 && groups.length) groups.at(-1).push(...ws);
    else if (b !== 0) groups.push(ws);
    if ([8, 64].includes(b)) groups.push([]);
  }
  expected.push(...rows.filter((r) => r.rep === rep).map((r) => r.words), ...groups);
}
const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(actual.length, expected.length);
for (const [i, ws] of expected.entries()) {
  assert.equal(actual[i].length, ws.length, `${arm} rep=${Math.floor(i / 7)} row=${i % 7} length`);
  for (const [j, w] of ws.entries())
    assert.equal(actual[i][j], w, `${arm} rep=${Math.floor(i / 7)} row=${i % 7} word=${j}`);
}
console.log(`${arm}: 32 golden model snapshots and 1024 exact per-episode reports match`);
