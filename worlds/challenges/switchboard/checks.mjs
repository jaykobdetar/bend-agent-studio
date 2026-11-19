import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  oracle,
  reactiveOracle,
  worldDefinition,
} from '../../../core/finite_world.mjs';
import { beliefOracle } from '../../../core/public_oracle.mjs';
import { encodings, switchboard, switchboardHorizon } from './switchboard.mjs';

test('checked fixtures and portable experiment regenerate exactly', () => {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('./generate.mjs', import.meta.url)),
    '--check',
  ]);
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../../experiment.mjs', import.meta.url)),
      'validate',
      fileURLToPath(
        new URL('../../../experiments/switchboard.json', import.meta.url),
      ),
    ],
    { encoding: 'utf8' },
  );
  assert.match(output, /48 trials/);
});

test('every cue word and query yield identical underlying paths across public encodings', () => {
  for (const width of [2, 4, 8]) {
    for (const delay of [0, 2, 9]) {
      for (const encoding of encodings) {
        const { definition, stride, horizon } = switchboard(
          width,
          delay,
          encoding,
        );
        const world = worldDefinition(definition);
        const index = new Map(world.states.map((s) => [s.id, s]));
        const terminal =
          2 ** width * width + (2 ** (width + 1) - 2) + delay * 2 ** width + 1;
        const endVariants =
          encoding === 'full' ? 2 ** width : encoding === 'latest' ? 2 : 1;
        assert.equal(world.states.length, terminal - 1 + endVariants);
        assert.deepEqual(
          world.initial.map((x) => x.weight),
          [1, 1],
        );
        const queryViews = new Map();
        for (let mask = 0; mask < 2 ** width; mask++) {
          for (let query = 0; query < width; query++) {
            const bit = (i) => (mask >> i) & 1;
            let state = index.get(world.initial[bit(0)].to);
            let memory = 0;
            for (let step = 0; step < horizon - 1; step++) {
              const before = step < width ? 2 * step + bit(step) : 2 * width;
              assert.equal(state.observation, memory * stride + before);
              assert.deepEqual(
                state.actions.map((a) => a.id),
                [2],
              );
              const outcomes = state.actions[0].outcomes;
              const expectedChoices =
                step < width - 1 ? 2 : step === horizon - 2 ? width : 1;
              assert.equal(outcomes.length, expectedChoices);
              for (const { reward, weight } of outcomes)
                assert.deepEqual([reward, weight], [0, 1]);
              const choice =
                step < width - 1
                  ? bit(step + 1)
                  : expectedChoices === 1
                    ? 0
                    : query;
              state = index.get(outcomes[choice].to);
              if (step < width && encoding === 'full')
                memory += bit(step) * 2 ** step;
              if (step < width && encoding === 'latest') memory = bit(step);
            }
            assert.equal(
              state.observation,
              memory * stride + 2 * width + 1 + query,
            );
            assert.deepEqual(
              state.actions.map((a) => a.id),
              [0, 1],
            );
            const counts = queryViews.get(state.observation) ?? [0, 0];
            counts[bit(query)]++;
            queryViews.set(state.observation, counts);
            for (const action of state.actions) {
              assert.equal(action.outcomes.length, 1);
              const outcome = action.outcomes[0];
              assert.equal(outcome.weight, 1);
              assert.equal(outcome.reward, action.id === bit(query) ? 1 : -1);
              assert.equal(index.get(outcome.to).actions.length, 0);
            }
          }
        }
        const favorableCases = [...queryViews.values()].reduce(
          (n, counts) => n + Math.max(...counts),
          0,
        );
        const exactReturn = (2 * favorableCases) / (width * 2 ** width) - 1;
        assert.equal(
          exactReturn,
          encoding === 'full' ? 1 : encoding === 'latest' ? 1 / width : 0,
        );
      }
    }
  }
});

test('finite and public-policy oracles agree with exact analytic baselines', () => {
  for (const encoding of encodings) {
    const { definition, horizon } = switchboard(2, 2, encoding);
    const world = worldDefinition(definition);
    const row = reactiveOracle(world, horizon);
    assert.equal(row.optimalFullStateReturn, 1);
    assert.equal(row.uniformReturn, 0);
    assert.equal(
      row.optimalStationaryReactiveReturn,
      { raw: 0, latest: 0.5, full: 1 }[encoding],
    );
  }
  const { definition, horizon } = switchboard(4, 2);
  const world = worldDefinition(definition);
  assert.equal(oracle(world, horizon).uniformReturn, 0);
  assert.equal(beliefOracle(world, horizon).optimalPublicHistoryReturn, 1);
});

test('unsupported dimensions and encoding are rejected before allocation', () => {
  for (const args of [
    [0, 1],
    [9, 1],
    [16, 1],
    [2, -1],
    [4, 129],
    [8, 2, 'hidden-mask'],
  ])
    assert.throws(() => switchboard(...args));
  assert.equal(switchboardHorizon(16, 128, 'full', { native: true }), 145);
  assert.throws(() => switchboardHorizon(32, 0, 'full', { native: true }));
  assert.throws(() => switchboardHorizon(16, 129, 'full', { native: true }));
});
