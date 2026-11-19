import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {compilerTest} from '../../checks/support.mjs';
import {bendSource, buckets, usesPackedWorld, worldDefinition} from '../../core/finite_world.mjs';
import {packedSource} from '../../core/packed_world.mjs';

const bend = process.env.BEND ?? 'bend';
const root = fileURLToPath(new URL('../../', import.meta.url));
const MASK = 0xffffffff,
  WORDS = 0x100000000n;
function cuts(xs) {
  const total = xs.reduce((n, x) => n + BigInt(x.weight), 0n);
  let sum = 0n;
  return xs.map((x) => Number(((sum += BigInt(x.weight)) * WORDS) / total - 1n));
}
function pair(xs, word, edges) {
  const x = xs[edges.findIndex((v) => word <= v)];
  return [x.to, x.reward ?? 0];
}
function mix(z) {
  let a = Math.imul(z ^ (z >>> 16), 2246822507),
    b = Math.imul(a ^ (a >>> 13), 3266489909);
  return (b ^ (b >>> 16)) >>> 0;
}
function values(list) {
  const v = [];
  while (list.$ === 'Con') {
    v.push(list.head);
    list = list.tail;
  }
  assert.equal(list.$, 'Nil');
  return v;
}
const single = {
  schema: 1,
  initial: [{to: MASK, weight: 1}],
  states: [
    {
      id: MASK,
      observation: 0,
      actions: [
        {
          id: MASK,
          outcomes: [
            {to: 0, reward: -0, weight: 1},
            {to: MASK, reward: Math.fround(1e21), weight: 7},
            {to: 0, reward: 2 ** -149, weight: 3},
            {to: MASK, reward: -3.5, weight: 2},
          ],
        },
      ],
    },
    {id: 0, observation: MASK, actions: []},
  ],
};
test(
  'packed layout matches independent integer cutpoints and literal fallback semantics',
  compilerTest,
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-packed-check-'));
    try {
      for (const f of ['packed_world.bend', 'finite.bend', 'engine.bend', 'history.bend'])
        fs.copyFileSync(path.join(root, 'core', f), path.join(dir, f));
      for (const [name, raw] of [
        ['edge', single],
        ...['taxi', 'blackjack'].map((k) => [
          k,
          JSON.parse(fs.readFileSync(path.join(root, 'worlds/benchmarks/toy-text', k + '.json'))),
        ]),
      ]) {
        const w = worldDefinition(raw);
        assert.equal(usesPackedWorld(w), name !== 'edge');
        const file = path.join(dir, name + '.bend'),
          js = path.join(dir, name + '.mjs');
        fs.writeFileSync(file, name === 'edge' ? packedSource(w, buckets) : bendSource(w));
        execFileSync(bend, [file, '-o', js], {env: {...process.env, BEND_NO_TELEMETRY: '1'}});
        const api = (await import(pathToFileURL(js))).default;
        const ranks = [...new Set(w.states.map((s) => s.observation))].sort((a, b) => a - b);
        for (const [i, obs] of ranks.entries()) assert.equal(api.rank(obs), i);
        assert.equal(api.rank(0x8000ffaa), 0);
        const starts = cuts(w.initial);
        for (let seed = 0; seed < 1024; seed++)
          assert.equal(api.reset(seed), pair(w.initial, mix(seed ^ 3266489917), starts)[0]);
        let count = 0;
        for (const s of w.states) {
          const v = api.view(s.id);
          assert.equal(v.observation, s.observation);
          assert.equal(v.$, s.actions.length ? 'Open' : 'End');
          if (s.actions.length)
            assert.deepEqual(
              values(v.actions),
              s.actions.map((a) => a.id),
            );
          const illegal = s.actions.some((a) => a.id === MASK) ? 42 : MASK;
          assert.deepEqual(api.step(s.id, illegal, MASK), {$: 'Tuple', fst: s.id, snd: 0});
          for (const a of s.actions) {
            const edges = cuts(a.outcomes);
            const words = new Set([0, MASK, ...edges.flatMap((v) => [v, Math.min(v + 1, MASK)])]);
            for (const word of words) {
              const [to, reward] = pair(a.outcomes, word, edges),
                p = api.step(s.id, a.id, word);
              assert.equal(p.fst, to);
              assert.ok(Object.is(p.snd, reward), name + ' reward bits');
              count++;
            }
          }
        }
        const missing = 0x8000ffaa;
        assert.deepEqual(api.view(missing), {$: 'End', observation: missing});
        assert.deepEqual(api.step(missing, 0, 0), {$: 'Tuple', fst: missing, snd: 0});
        console.log(
          name + ': ' + w.states.length + ' states; ' + count + ' transition-boundary probes',
        );
      }
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  },
);

test(
  'large and literal archives agree through step cuts, replay, history and rerun',
  compilerTest,
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-packed-archive-'));
    const cli = (entry, args) =>
      execFileSync(process.execPath, [entry, ...args], {
        encoding: 'utf8',
        env: {...process.env, BEND_NO_TELEMETRY: '1'},
        maxBuffer: 16 * 1024 * 1024,
      });
    try {
      const small = JSON.parse(
        fs.readFileSync(path.join(root, 'worlds/benchmarks/toy-text/lake4-slip.json')),
      );
      const padded = {
        ...small,
        states: [
          ...small.states,
          ...Array.from({length: 128 - small.states.length}, (_, i) => ({
            id: 1000 + i,
            observation: 0,
            actions: [],
          })),
        ],
      };
      // Extra states are unreachable and introduce no new public observations or ranks.
      const plan = {
        schema: 1,
        name: 'layout-parity',
        games: [
          {id: 'literal', definition: small, limit: 8},
          {id: 'packed', definition: padded, limit: 8},
        ],
        arms: [
          {id: 'q', method: 'q_learning'},
          {id: 'memory', method: 'q_learning', observation: 'previous'},
        ],
        replicates: 1,
        budgetUnit: 'steps',
        maxTrainEpisodes: 20,
        checkpoints: [0, 1, 5, 17],
        validationEpisodes: 4,
        testEpisodes: 4,
        seeds: {train: 1234, validation: 98765, test: 392045, stride: 1000},
      };
      const spec = path.join(dir, 'spec.json'),
        run = path.join(dir, 'run'),
        rerun = path.join(dir, 'rerun'),
        archived = path.join(run, 'code/experiment.mjs');
      fs.writeFileSync(spec, JSON.stringify(plan));
      cli(path.join(root, 'experiment.mjs'), ['run', spec, run, '--until', '1']);
      assert.ok(fs.existsSync(path.join(run, 'code/packed_world.bend')));
      cli(archived, ['resume', run]);
      cli(archived, ['verify', run]);
      cli(archived, ['rerun', run, rerun]);
      cli(archived, ['verify', rerun]);
      for (const arm of plan.arms)
        for (const n of plan.checkpoints) {
          const row = (game) => path.join('trials', game, arm.id, '0', n + '.json');
          const data = {};
          for (const game of ['literal', 'packed']) {
            const f = row(game),
              bytes = fs.readFileSync(path.join(run, f));
            assert.deepEqual(bytes, fs.readFileSync(path.join(rerun, f)));
            const {experiment, parent, game: tag, ...body} = JSON.parse(bytes).body;
            data[game] = body;
          }
          assert.deepEqual(data.packed, data.literal);
        }
      for (const arm of plan.arms)
        for (const phase of ['validation', 'test']) {
          const trace = (game) => {
            const {game: tag, ...record} = JSON.parse(
              cli(archived, ['replay', run, game, arm.id, '0', '17', phase, '0']),
            );
            return record;
          };
          assert.deepEqual(trace('packed'), trace('literal'));
        }
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  },
);
