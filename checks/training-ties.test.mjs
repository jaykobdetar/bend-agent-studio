import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {compilerTest} from './support.mjs';
import {execute} from '../core/process_output.mjs';
import {unpack} from '../core/experiment.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const bend = process.env.BEND ?? 'bend';
const ids = [71, 11, 19];
const next = (word) => (Math.imul(word, 1664525) + 1013904223) >>> 0;
const temporary = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-training-ties-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
};

test(
  'greedy training samples exact maxima and deployed paths keep first-max evaluation',
  compilerTest,
  async (t) => {
    const dir = temporary(t);
    const backend = path.join(dir, 'ties.mjs');
    await execute(bend, [path.join(repo, 'checks/training_ties.bend'), '-o', backend]);
    const api = (await import(pathToFileURL(backend).href)).default;
    let word = 1729;
    for (const a of [-1, 0, 1])
      for (const b of [-1, 0, 1])
        for (const c of [-1, 0, 1]) {
          const values = [a, b, c],
            max = Math.max(...values);
          const tied = ids.filter((_, i) => values[i] === max);
          for (let i = 0; i < 64; i++) {
            word = next(word);
            assert.ok(tied.includes(api.sample(a, b, c, word)));
            assert.equal(api.evaluate(a, b, c, word), tied[0]);
            if ((word & 3) !== 0) assert.ok(tied.includes(api.training_epsilon(a, b, c, word)));
            else assert.equal(api.training_epsilon(a, b, c, word), ids[(word >>> 2) % ids.length]);
          }
        }
    for (const x of [0, 2246822519, 0xffff_ffff]) {
      assert.equal(api.sample_empty(x), 0);
      assert.equal(api.sample_single(x), 27);
      assert.equal(api.sample(1, -1, NaN, x), 71);
      assert.equal(api.sample(NaN, NaN, NaN, x), 19);
      assert.equal(api.evaluate(1, -1, NaN, x), 19); // preserve legacy unordered evaluation
    }
    const routeIds = [ids, ids, ids, [2, 0, 1], ids, ids, ids];
    const explored = routeIds.map(() => new Set());
    for (let i = 0; i < 128; i++) {
      word = next(word);
      assert.deepEqual(
        unpack(api.evaluation_paths(word)),
        routeIds.map((a) => a[0]),
      );
      unpack(api.training_paths(word)).forEach((a, j) => {
        assert.ok(routeIds[j].includes(a));
        explored[j].add(a);
      });
    }
    explored.forEach((choices) => assert.equal(choices.size, 3));

    // Three tied values plus the immediately smaller F32 value; non-power-of-two
    // tie count exercises rejection. This input maps the first tie draw to zero.
    assert.equal(api.four_way(2246822519), 19, 'reject zero, then use the next mixed draw');
    const N = 30_000,
      counts = new Map(ids.map((a) => [a, 0])),
      greedy = new Map(counts);
    let greedyN = 0;
    word = 0x6359_29e3;
    for (let i = 0; i < N; i++) {
      word = next(word);
      const a = api.four_way(word);
      assert.ok(counts.has(a), 'adjacent lower F32 is not tied');
      counts.set(a, counts.get(a) + 1);
      if ((word & 3) !== 0) {
        // Draws that already took the non-exploratory branch still cover the ties.
        const picked = api.training_epsilon(4, 4, 4, word);
        assert.ok(greedy.has(picked));
        greedy.set(picked, greedy.get(picked) + 1);
        greedyN++;
      }
    }
    for (const [label, bins, n] of [
      ['all words', counts, N],
      ['non-exploratory words', greedy, greedyN],
    ]) {
      const expected = n / 3;
      const chiSquare = [...bins.values()].reduce(
        (sum, x) => sum + (x - expected) ** 2 / expected,
        0,
      );
      t.diagnostic(
        label +
          ', legal order [71,11,19]: ' +
          [...bins.values()].join(', ') +
          '; chi-square ' +
          chiSquare.toFixed(3),
      );
      assert.ok(chiSquare < 13.81551056, 'chi-square threshold for 2 df at p=0.001: ' + chiSquare);
    }
  },
);

test(
  'zero-epsilon Q climbs a four-move corridor instead of staying at the first legal self-loop',
  compilerTest,
  async (t) => {
    const dir = temporary(t),
      run = path.join(dir, 'run'),
      plan = path.join(dir, 'plan.json');
    // Fixed before running: no exploratory transitions; observe only the terminal
    // reward. The predecessor cannot leave observation zero at any training budget.
    fs.writeFileSync(
      plan,
      JSON.stringify({
        schema: 1,
        name: 'greedy-tie-corridor',
        games: [
          {id: 'corridor', file: path.join(repo, 'checks/fixtures/tie-corridor.json'), limit: 12},
        ],
        arms: [{id: 'q', method: 'q_learning', alpha: 0.25, gamma: 1, epsilon: 0}],
        replicates: 1,
        checkpoints: [0, 24],
        validationEpisodes: 1,
        testEpisodes: 3,
        seeds: {train: 1729, validation: 2718, test: 3141, stride: 100},
      }),
    );
    const cli = (...args) =>
      execute(process.execPath, [path.join(repo, 'experiment.mjs'), ...args]);
    await cli('run', plan, run);
    await cli('verify', run);
    const result = JSON.parse(fs.readFileSync(path.join(run, 'trials/corridor/q/0/24.json'))).body;
    assert.ok(result.train.terminal > 0, JSON.stringify(result.train));
    assert.equal(result.test.terminal, 3);
    assert.equal(result.test.sum, 3);
    const trace = JSON.parse(
      (await cli('replay', run, 'corridor', 'q', '0', '24', 'test', '0')).stdout,
    );
    assert.equal(trace.score, 1);
    assert.deepEqual(
      trace.frames.filter((f) => f.accepted).map((f) => f.action),
      [1, 1, 1, 1],
    );
  },
);
