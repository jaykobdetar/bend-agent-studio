// Run from any directory. Arguments: pinned ES module from study.bend,
// ES module from probe.bend, native executable from probe.bend.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {validate, settings, seedOf} from '../../core/experiment_config.mjs';
const [studyFile, probeFile, nativeFile] = process.argv.slice(2);
const moduleAt = async (p) => (await import(pathToFileURL(path.resolve(p)).href)).default;
const study = await moduleAt(studyFile),
  probe = await moduleAt(probeFile);
const plan = (name) =>
  validate(
    JSON.parse(readFileSync(new URL('../../experiments/' + name + '.json', import.meta.url))),
  );
const cp = plan('cartpole'),
  nf = plan('maximization-bias');
const bits = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b.readUInt32LE();
};
function list(xs, f = (x) => x) {
  const out = [];
  for (; xs.$ === 'Con'; xs = xs.tail) out.push(f(xs.head));
  assert.equal(xs.$, 'Nil');
  return out;
}
const mode = {$: 'Train'};
function direct(p, armID, i, episodes = 1) {
  const g = p.games[0],
    a = p.arms.find((a) => a.id === armID),
    s = settings(a, g),
    k = seedOf(p, i, 'train');
  const pole = g.id === 'cartpole';
  let model = pole ? study.pole_initial(s, k) : study.initial_for(s, k),
    r;
  for (let j = 0; j < episodes; j++) {
    r = pole
      ? study.pole_episode(mode, model, k + j, g.limit)
      : study.episode({$: 'NoisyForkGame'}, mode, model, k + j, g.limit);
    model = r.model;
  }
  const m = r.model,
    t = m.settings;
  const v = [
    bits(r.score),
    r.steps,
    {Terminal: 0, Limit: 1, Illegal: 2}[r.reason.$],
    r.reason.action ?? 0,
  ];
  if (pole) {
    assert.equal(m.$, 'Network');
    assert.equal(t.method.$, 'NetworkAC');
    v.push(2, ...[t.actor_rate, t.critic_rate, t.gamma, m.logit_bias, m.value_bias].map(bits));
    for (const n of list(m.units))
      v.push(
        ...[n.input.x, n.input.v, n.input.angle, n.input.speed, n.bias, n.actor, n.critic].map(
          bits,
        ),
      );
  } else {
    assert.equal(m.$, 'Agent');
    assert.equal(t.method.$, 'QLearning');
    v.push(2, bits(t.alpha), bits(t.gamma), t.exploration);
    for (const e of list(m.values)) v.push(e.observation, e.action, e.visits, bits(e.value));
  }
  return v;
}
const measures = {};
function timed(name, fn) {
  const start = performance.now();
  const result = fn();
  (measures[name] ??= []).push(performance.now() - start);
  return result;
}
const counts = {noisy: 0, pole: 0, checkpoint: 0, cos: 0, tanh: 0, sqrt: 0, log: 0};
const first = {};
const median = (xs) => {
  xs = [...xs].sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  return (xs[m] + xs[xs.length - 1 - m]) / 2;
};
probe.row(0); // warm up once; native measures always start a fresh CPU process
for (let i = 0; i < 32; i++) {
  const js = timed('JS in-process + unpack', () => list(probe.row(i), (v) => list(v)));
  assert.deepEqual(js.slice(0, 2), [direct(nf, 'q', i), direct(cp, 'network', i)]);
  assert.deepEqual(js[3], direct(nf, 'q', i, 1024));
  const native = (threads) =>
    timed('native launch + parse (' + threads + ' threads)', () => {
      const p = spawnSync(
        path.resolve(nativeFile),
        [String(i), '+RTS', '--threads', String(threads)],
        {encoding: 'utf8', timeout: 30000, maxBuffer: 2 ** 20},
      );
      if (p.error) throw p.error;
      assert.equal(p.status, 0, p.stderr);
      return JSON.parse(p.stdout);
    });
  // Alternate order so thread count isn't always confounded with first run.
  const ns = i % 2 ? [native(4), native(1)] : [native(1), native(4)];
  assert.deepEqual(ns[0], ns[1]);
  for (const [name, j, n] of [
    ['noisy', js[0], ns[0][0]],
    ['pole', js[1], ns[0][1]],
    ['checkpoint', js[3], ns[0][3]],
    ...['cos', 'tanh', 'sqrt', 'log'].map((name, k) => [name, [js[2][k]], [ns[0][2][k]]]),
  ]) {
    if (j.length === n.length && j.every((v, k) => v === n[k])) counts[name]++;
    else if (!first[name]) {
      const k = j.findIndex((v, i) => v !== n[i]);
      first[name] = {
        rep: i,
        word: k,
        js: j[k],
        native: n[k],
        jsWords: j.length,
        nativeWords: n.length,
      };
    }
  }
}
const stress = {mismatches: {cos: 0, tanh: 0, sqrt: 0, log: 0}, first: {}};
for (let block = 0; block < 64; block++) {
  const p = spawnSync(path.resolve(nativeFile), [String(32 + block), '+RTS', '--threads', '1'], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 ** 20,
  });
  if (p.error) throw p.error;
  assert.equal(p.status, 0, p.stderr);
  const actual = JSON.parse(p.stdout),
    js = list(probe.sweep(64, block * 64), (v) => list(v));
  assert.equal(actual.length, 64);
  for (let j = 0; j < 64; j++)
    for (const [k, op] of ['cos', 'tanh', 'sqrt', 'log'].entries()) {
      assert.equal(actual[j].length, 4);
      if (js[j][k] !== actual[j][k]) {
        stress.mismatches[op]++;
        stress.first[op] ??= {index: 64 * block + j, js: js[j][k], native: actual[j][k]};
      }
    }
}
console.log(
  JSON.stringify(
    {
      replicates: 32,
      stress,
      equal: counts,
      firstMismatch: first,
      medianMs: Object.fromEntries(Object.entries(measures).map(([k, v]) => [k, median(v)])),
    },
    null,
    2,
  ),
);
