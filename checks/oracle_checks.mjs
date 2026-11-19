import assert from 'node:assert/strict';
import fs from 'node:fs';
import {beliefOracle, clockOracle, explainDecisions, policyOracle} from '../core/public_oracle.mjs';
import {worldDefinition} from '../core/finite_world.mjs';

const load = (name) =>
  worldDefinition(
    JSON.parse(fs.readFileSync(new URL('../worlds/' + name + '.json', import.meta.url), 'utf8')),
  );
const clue = load('reward-cue');
assert.equal(beliefOracle(clue, 2).optimalPublicHistoryReturn, 2.5);
const frames = [
  {
    observation: 99,
    legal: [0],
    action: 0,
    accepted: true,
    reward: 1,
    nextObservation: 10,
    nextLegal: [1, 2],
    terminal: false,
    truncated: false,
  },
  {
    observation: 10,
    legal: [1, 2],
    action: 1,
    accepted: true,
    reward: 0,
    nextObservation: 0,
    nextLegal: [],
    terminal: true,
    truncated: false,
  },
];
assert.deepEqual(
  explainDecisions(clue, 2, frames).decisions.map((d) => d.gap),
  [0, 2],
);
assert.throws(() => explainDecisions(clue, 2, [{...frames[0], reward: -5}]), /impossible/);
const tiger = load('tiger');
assert.ok(Math.abs(beliefOracle(tiger, 8).optimalPublicHistoryReturn - 4.765635530480979) < 1e-10);
assert.throws(() => beliefOracle(tiger, 8, {maxBeliefs: 1}), /budget/);
const dispatch = load('dispatch'),
  preferred = (_s, legal) => legal[0],
  trained = (s) => (s === 0 ? 4 : 7);
const known = policyOracle(dispatch, 2, trained, {behavior: () => [0.875, 0.125]});
assert.equal(known.expectedReturn, -0.5);
assert.equal(known.returnVariance, 18.75);
assert.equal(known.overlap.asymptoticEssFraction, 0.109375);
assert.equal(
  policyOracle(dispatch, 2, trained, {behavior: preferred}).overlap
    .unsupportedTargetPathProbability,
  1,
);
const loop = {
  initial: [{to: 0, weight: 1}],
  states: [{id: 0, actions: [{id: 9, outcomes: [{to: 0, reward: 1, weight: 1}]}]}],
};
assert.equal(beliefOracle(loop, 30000).optimalPublicHistoryReturn, 30000);
assert.equal(policyOracle(loop, 30000, () => 9).expectedReturn, 30000);
assert.throws(() => policyOracle(loop, 30000, () => 9, {maxStates: 64}), /budget/);
const rare = {
  initial: [{to: 0, weight: 1}],
  states: [
    {
      id: 0,
      actions: [
        {
          id: 4,
          outcomes: [
            {to: 0, weight: 1, reward: 0},
            {to: 1, weight: 1, reward: 0},
          ],
        },
        {id: 7, outcomes: [{to: 1, weight: 1, reward: 1}]},
      ],
    },
    {id: 1, actions: []},
  ],
};
const tiny = policyOracle(rare, 1100, (_o, _l, left) => (left === 1 ? 7 : 4), {
  behavior: () => 4,
}).overlap;
assert.equal(tiny.coverageComplete, false);
assert.equal(tiny.unsupportedTargetPathProbability, null);
assert.equal(tiny.ordinaryVariancePerEpisode, null);
assert.ok(Math.abs(clockOracle(tiger, 8).optimalClockReactiveReturn + 2.591893855767211) < 1e-10);
assert.equal(clockOracle(clue, 2).optimalClockReactiveReturn, 1.5);
const switches = load('two-switches');
assert.equal(clockOracle(switches, 2).optimalClockReactiveReturn, 1);
assert.equal(policyOracle(switches, 2, () => [0.5, 0.5]).expectedReturn, 0.25);
assert.equal(policyOracle(switches, 2, () => 0).expectedReturn, 0);
assert.equal(policyOracle(switches, 2, () => 1).expectedReturn, 0);
console.log('Public-history planning, decision auditing and importance-weight moments passed.');

const {discountedOracle, oracle} = await import('../core/finite_world.mjs');
const bridge = load('bridge'),
  detour = load('detour');
for (const solution of ['valueIteration', 'policyIteration']) {
  assert.equal(
    discountedOracle(bridge, 1)[solution].optimalFullStateReturn,
    oracle(bridge, 100).optimalFullStateReturn,
  );
  const g = 0.95,
    steps = 10;
  // Nine ordinary step costs, then the terminal reward on step ten.
  const expected = -(1 - g ** (steps - 1)) / (1 - g) + 8 * g ** (steps - 1);
  assert.ok(
    Math.abs(discountedOracle(detour, g)[solution].optimalFullStateReturn - expected) < 1e-8,
  );
}
assert.throws(() => discountedOracle(detour, 1), /acyclic/);
assert.throws(() => discountedOracle(bridge, 0.9, 0), /tolerance/);
assert.ok(
  Math.abs(
    oracle(detour, 100, 0.95).optimalFullStateReturn -
      discountedOracle(detour, 0.95).valueIteration.optimalFullStateReturn,
  ) < 1e-9,
);
const geometric = worldDefinition({
  schema: 1,
  initial: [{to: 0, weight: 1}],
  states: [
    {
      id: 0,
      actions: [
        {
          id: 4,
          outcomes: [
            {to: 0, reward: 1, weight: 1},
            {to: 1, reward: 1, weight: 1},
          ],
        },
      ],
    },
    {id: 1, actions: []},
  ],
});
for (const g of [0, 0.5, 0.99]) {
  const result = discountedOracle(geometric, g, 1e-10);
  for (const solver of [result.policyIteration, result.valueIteration])
    assert.ok(Math.abs(solver.optimalFullStateReturn - 1 / (1 - g / 2)) < 1e-10);
}
assert.throws(() => discountedOracle(geometric, 1), /acyclic/);

const {exportPomdp} = await import('../tools/export_pomdp.mjs');
const bridgeInput = JSON.parse(fs.readFileSync(new URL('../worlds/bridge.json', import.meta.url)));
const file = exportPomdp(bridgeInput, {illegalPenalty: -42});
assert.equal(file, exportPomdp(bridgeInput, {illegalPenalty: -42}));
assert.match(file, /T: a9 : s0 : sink 1\nR: a9 : s0 : sink : \* -42/);
assert.match(file, /T: a7 : s3 : s3 1/);
assert.match(file, /O: \* : s2 : o2 1/);
assert.throws(() => exportPomdp(bridgeInput, {illegalPenalty: Infinity}), /penalty/);
