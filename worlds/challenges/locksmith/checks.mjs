import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {oracle, usesPackedWorld, worldDefinition} from '../../../core/finite_world.mjs';
import {courier, designs} from './courier.mjs';

function optimalLength(detours, charges) {
  // A keyed crossing always requires at least one complete round trip.
  // Each charge removes exactly 2 * distance moves. Sort the savings
  // independently of the generated state graph.
  return [...detours]
    .sort((a, b) => b - a)
    .reduce((total, depth, i) => total + 1 + (i < charges ? 0 : 2 * depth), 0);
}

function uniformBruteForce(definition, id, left) {
  const actions = definition.states[id].actions;
  if (!left || !actions.length) return 0;
  return actions.reduce((total, action) => {
    const [x] = action.outcomes;
    return total + (x.reward + uniformBruteForce(definition, x.to, left - 1)) / actions.length;
  }, 0);
}

function play(definition, actionIDs) {
  let id = definition.initial[0].to;
  let score = 0;
  for (const actionId of actionIDs) {
    const state = definition.states[id];
    const action = state.actions.find((a) => a.id === actionId);
    assert.ok(action, 'expected action ' + actionId + ' to be legal at state ' + id);
    const [{to, reward}] = action.outcomes;
    id = to;
    score += reward;
  }
  return {id, score, legal: definition.states[id].actions.map((a) => a.id)};
}

const turn = (depth) => [...Array(depth).fill(0), ...Array(depth).fill(1), 2];

test('generated files and manifest match the generator; shipped worlds straddle the packing cutoff', () => {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('./generate.mjs', import.meta.url)),
    '--check',
  ]);
  for (const [id, n, packed, value] of [
    ['locksmith-3', 32, false, 29],
    ['locksmith-8', 204, true, 110],
  ]) {
    const {detours, bypasses} = designs[id];
    const {limit} = courier(detours, bypasses);
    const normalized = worldDefinition(
      JSON.parse(readFileSync(new URL('./' + id + '.json', import.meta.url), 'utf8')),
    );
    assert.equal(normalized.states.length, n);
    assert.equal(usesPackedWorld(normalized), packed);
    assert.equal(oracle(normalized, limit).optimalFullStateReturn, value);
  }
});

test('Bellman values agree with sorted savings at exact completion boundaries', () => {
  for (const detours of [[1], [1, 2], [2, 1], [3, 1, 4, 4], [1, 4, 2], [2, 7, 1, 5, 8, 2, 6, 3]]) {
    for (let k = 0; k <= Math.min(6, detours.length); k++) {
      const {definition, delivery, limit} = courier(detours, k);
      const minMoves = optimalLength(detours, k);
      const normalized = worldDefinition(definition);
      assert.equal(oracle(normalized, limit).optimalFullStateReturn, delivery - minMoves);
      assert.equal(oracle(normalized, minMoves).optimalFullStateReturn, delivery - minMoves);
      assert.equal(oracle(normalized, minMoves - 1).optimalFullStateReturn, 1 - minMoves);
    }
  }
});

test('progress, charge consumption and key consumption match hand-played traces', () => {
  const {definition} = courier([1, 4, 2], 1);
  assert.deepEqual(play(definition, []).legal, [0, 3]);
  assert.deepEqual(play(definition, [0, 1]).legal, [0, 2, 3]);
  assert.deepEqual(play(definition, turn(1)).legal, [0, 3]);
  assert.deepEqual(play(definition, [...turn(1), 3]).legal, [0]);
  const best = play(definition, [...turn(1), 3, ...turn(2)]);
  const greedy = play(definition, [3, ...turn(4), ...turn(2)]);
  assert.deepEqual(best.legal, []);
  assert.equal(best.id, greedy.id);
  assert.equal(best.score, 29);
  assert.equal(greedy.score, 23);
});

test('tiny uniform value independently enumerates all action trees', () => {
  const {definition, limit} = courier([1, 2], 1);
  const normalized = worldDefinition(definition);
  assert.ok(
    Math.abs(
      uniformBruteForce(definition, definition.initial[0].to, limit) -
        oracle(normalized, limit).uniformReturn,
    ) < 1e-10,
  );
});

test('generation accepts bounded scaling and rejects malformed or unsupported inputs', () => {
  const {definition: largest} = courier(Array(32).fill(12), 6);
  assert.equal(largest.states.length, 5076);
  assert.equal(worldDefinition(largest).states.length, largest.states.length);
  for (const [xs, n] of [
    [[], 0],
    [[0], 0],
    [[13], 0],
    [Array(33).fill(1), 0],
    [Array(2), 1],
    [[1], 2],
    [[1], 0.5],
  ])
    assert.throws(() => courier(xs, n), /provide/);
});
