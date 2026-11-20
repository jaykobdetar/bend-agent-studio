// P11.6 diagnostic. Reads a trusted historical archive; never executes its backend.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync, statSync} from 'node:fs';
import {existing, unseal} from '../../core/experiment.mjs';

const [archive, candidate, ...rest] = process.argv.slice(2);
assert(archive && !rest.length, 'usage: node check-model-words.mjs ARCHIVE [CANDIDATE_JSON]');
const identity = JSON.parse(
  readFileSync(new URL('../../studies/flagship-toy-text-v2/identity.json', import.meta.url)),
);
const manifest = unseal(path.join(archive, 'run.json'));
assert.equal(manifest.hash, identity.sealedManifestHash, 'use the actual flagship v2 archive');
assert.deepEqual(manifest.body.toolchain, identity.toolchain);
const plan = manifest.body.plan;
const game = plan.games.find((g) => g.id === 'lake4-slip');
assert(game && plan.budgetUnit === 'episodes');
const reps = 8;
const budgets = [0, 8, 64, 128];
const arms = ['q_learning', 'dyna_q'];
assert(plan.replicates >= reps && budgets.every((n) => plan.checkpoints.includes(n)));

const f = new DataView(new ArrayBuffer(4));
function bits(x) {
  assert(Number.isFinite(x));
  f.setFloat32(0, x);
  assert(Object.is(f.getFloat32(0), x), 'checkpoint number must already be a binary32 value');
  return f.getUint32(0);
}
function u32(x) {
  assert(Number.isInteger(x) && x >= 0 && x <= 0xffffffff);
  return x;
}
function list(xs, emit) {
  while (xs.$ === 'Con') {
    emit(xs.head);
    xs = xs.tail;
  }
  assert.equal(xs.$, 'Nil');
}
function tree(node, words) {
  if (node.$ === 'Vacant') {
    words.push(0);
    return;
  }
  assert.equal(node.$, 'Node');
  assert.equal(node.cell.$, 'Cell');
  words.push(1, u32(node.s), u32(node.a), u32(node.cell.visits), bits(node.cell.value));
  tree(node.lo, words);
  tree(node.hi, words);
}
function table(xs, words) {
  if (xs.$ === 'Nil') {
    words.push(0);
    return;
  }
  assert.equal(xs.$, 'Con');
  assert.equal(xs.head.$, 'Indexed');
  assert.equal(xs.tail.$, 'Nil');
  words.push(1);
  tree(xs.head.tree, words);
}
function model(m, arm) {
  const p = m.settings;
  assert.equal(p.$, 'Settings');
  const prefix = [bits(p.alpha), bits(p.gamma), u32(p.exploration)];
  if (arm === 'q_learning') {
    assert.equal(m.$, 'Agent');
    assert.equal(p.method.$, 'QLearning');
    const words = [0, ...prefix];
    table(m.values, words);
    return words;
  }
  assert.equal(m.$, 'PlanningAgent');
  assert.equal(p.method.$, 'DynaQ');
  assert.equal(m.state.$, 'Planner');
  const d = m.state;
  const words = [1, ...prefix, u32(p.method.planning), u32(d.pairs), u32(d.seed)];
  table(d.values, words);
  let pairs = 0;
  list(d.experience, (pair) => {
    assert.equal(pair.$, 'PairModel');
    pairs++;
    words.push(1, u32(pair.obs), u32(pair.action), u32(pair.total));
    list(pair.outcomes, (s) => {
      assert.equal(s.$, 'Sample');
      words.push(1, u32(s.count), bits(s.reward), u32(s.next.observation));
      if (s.next.$ === 'End') words.push(0);
      else {
        assert.equal(s.next.$, 'Open');
        words.push(1);
        list(s.next.actions, (a) => words.push(1, u32(a)));
        words.push(0);
      }
    });
    words.push(0);
  });
  assert.equal(pairs, d.pairs);
  words.push(0);
  return words;
}

const rows = [];
for (const id of arms) {
  const arm = plan.arms.find((a) => a.id === id);
  assert(arm && !arm.agent);
  for (let rep = 0; rep < reps; rep++) {
    let previous = null;
    for (const budget of plan.checkpoints) {
      if (budget > budgets.at(-1)) break;
      const checkpoint = existing(archive, manifest.hash, {game, arm, rep}, budget, previous);
      assert(checkpoint, `missing checkpoint ${id}/${rep}/${budget}`);
      previous = checkpoint.hash;
      if (budgets.includes(budget))
        rows.push({arm: id, rep, budget, words: model(checkpoint.body.model, id)});
    }
  }
}
const expected = {schema: 1, source: manifest.hash, game: game.id, rows};
if (!candidate) {
  console.log(JSON.stringify(expected));
} else {
  assert(statSync(candidate).size <= 2 ** 23, 'candidate JSON exceeds 8 MiB');
  const actual = JSON.parse(readFileSync(candidate, 'utf8'));
  assert.equal(actual.schema, expected.schema);
  assert.equal(actual.source, expected.source);
  assert.equal(actual.game, expected.game);
  assert.equal(actual.rows.length, rows.length);
  for (const [i, {arm, rep, budget, words}] of rows.entries()) {
    const actualRow = actual.rows[i];
    assert.deepEqual(
      [actualRow.arm, actualRow.rep, actualRow.budget],
      [arm, rep, budget],
      `row ${i}`,
    );
    assert.equal(actualRow.words.length, words.length, `${arm}/${rep}/${budget} word count`);
    for (const [k, x] of words.entries())
      assert.equal(actualRow.words[k], x, `${arm}/${rep}/${budget} word ${k}`);
  }
  console.log(`${rows.length} diagnostic model snapshots match (not sealed checkpoint parity).`);
}
