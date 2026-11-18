import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspection} from './inspection.mjs';
import {seal, stats} from '../experiment.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const ctx = {
  repo,
  root: repo,
  archive: (d) => d,
  input: (f) => path.resolve(repo, f),
  exec: async (exe, args, opts) =>
    (await run(exe, args, {cwd: opts.cwd, timeout: opts.timeout, maxBuffer: opts.maxBytes})).stdout,
};
test('summarize returns replicate bootstrap statistics and rejects missing evaluation or damaged chains', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-summary-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const p = {
    name: 'smoke',
    games: [{id: 'bridge'}],
    arms: [{id: 'q'}],
    checkpoints: [0, 2],
    replicates: 2,
    seeds: {train: 2, test: 4, validation: 6, stride: 10},
  };
  const manifest = seal({plan: p});
  await fs.writeFile(path.join(dir, 'run.json'), manifest);
  for (let rep = 0; rep < 2; rep++) {
    const dest = path.join(dir, 'trials', 'bridge', 'q', String(rep));
    await fs.mkdir(dest, {recursive: true});
    let parent = null;
    for (const episodes of p.checkpoints) {
      const train = {...stats(), episodes, terminal: episodes, sum: episodes * (rep + 1)};
      const row = seal({
        experiment: JSON.parse(manifest).hash,
        parent,
        game: 'bridge',
        arm: 'q',
        rep,
        episodes,
        train,
        validation: stats(),
        test: null,
      });
      await fs.writeFile(path.join(dest, episodes + '.json'), row);
      parent = JSON.parse(row).hash;
    }
  }
  const tool = inspection.summarize_results;
  const args = {run: dir, phase: 'train', draws: 100};
  const {rows} = await tool.run(args, ctx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].budget, 2);
  assert.equal(rows[0].estimate, 1.5);
  assert.equal(rows[0].replicates, 2);
  assert.deepEqual(rows[0].interval, [1, 2]);
  assert.ok(Math.abs(rows[0].sd - Math.SQRT1_2) < 1e-10);
  await assert.rejects(tool.run({run: dir}, ctx), /no test episodes/);
  await fs.writeFile(path.join(dir, 'trials/bridge/q/1/2.json'), '{}');
  await assert.rejects(tool.run(args, ctx), /checksum/);
});
test('replay and explanation use archived coordinates; real oracle computes Bridge decision gaps', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-audit-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const world = JSON.parse(await fs.readFile(path.join(repo, 'worlds/bridge.json')));
  await fs.writeFile(
    path.join(dir, 'run.json'),
    seal({plan: {games: [{id: 'bridge', definition: world, limit: 2}]}}),
  );
  const frames = [
    {
      observation: 0,
      legal: [0, 7],
      action: 7,
      accepted: true,
      reward: 0,
      nextObservation: 1,
      nextLegal: [9],
      terminal: false,
      truncated: false,
    },
    {
      observation: 1,
      legal: [9],
      action: 9,
      accepted: true,
      reward: 3,
      nextObservation: 3,
      nextLegal: [],
      terminal: true,
      truncated: false,
    },
  ];
  const c = {
    ...ctx,
    nodeFor: () => '/trusted/archived-node',
    exec: async (exe, args, opts) => {
      if (exe === '/trusted/archived-node') {
        assert.deepEqual(args, [
          path.join(dir, 'code', 'experiment.mjs'),
          'replay',
          dir,
          'bridge',
          'q',
          '0',
          '2',
          'test',
          '0',
        ]);
        return JSON.stringify({score: 3, frames});
      }
      return ctx.exec(exe, args, opts);
    },
  };
  const a = {
    run: dir,
    game: 'bridge',
    arm: 'q',
    replicate: 0,
    checkpoint: 2,
    phase: 'test',
    episode: 0,
    limit: 1,
  };
  const r = await inspection.replay_episode.run(a, c);
  assert.deepEqual(r.frames, [frames[0]]);
  assert.equal(r.nextOffset, 1);
  assert.equal(r.total, 2);
  assert.equal(r.score, 3);
  const e = await inspection.explain_episode.run({...a, offset: 1}, c);
  assert.equal(e.decisions[0].step, 1);
  assert.equal(e.discountedDecisionGaps, 0);
  assert.equal(e.nextOffset, null);
});
