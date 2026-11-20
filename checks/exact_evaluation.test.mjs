// Exercise exact-evaluation clients against real Evaluate-mode archived rollouts.
// The untrained policies have tied values; action order and unequal returns make
// the finite-world choice observable without depending on any Q table encoding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gameGraph, matchup} from '../analysis/arena_tournament.mjs';
import {parameterList} from '../core/agent_source.mjs';
import {unpack} from '../core/experiment.mjs';
import {execute} from '../core/process_output.mjs';
import {explainDecisions} from '../core/public_oracle.mjs';
import {openDataset} from '../offline/dataset.mjs';
import {compilerTest} from './support.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const bend = process.env.BEND ?? 'bend';
const run = (file, ...args) => execute(process.execPath, [path.join(repo, file), ...args]);
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const episode = async (root, game, arm, index) =>
  JSON.parse(
    (await run('experiment.mjs', 'replay', root, game, arm, '0', '0', 'test', String(index)))
      .stdout,
  );

test(
  'exact evaluation preserves legal-order ties in archived Evaluate-mode rollouts',
  {...compilerTest, timeout: 60000},
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-exact-evaluation-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const loc = (name) => path.join(dir, name);
    const write = (name, value) => {
      const file = loc(name);
      fs.writeFileSync(file, JSON.stringify(value));
      return file;
    };
    const first = 7,
      alternate = 3;
    const move = (id, to, reward) => ({id, outcomes: [{to, reward, weight: 1}]});
    // Both opening moves have a fitted Q target of zero at gamma=0. Their
    // subsequent rewards differ, so score/exact-value agreement identifies
    // the selected opening move. The smaller action ID is deliberately second.
    const world = {
      schema: 1,
      initial: [{to: 0, weight: 1}],
      states: [
        {id: 0, actions: [move(first, 1, 0), move(alternate, 2, 0)]},
        {id: 1, actions: [move(9, 3, -4)]},
        {id: 2, actions: [move(9, 3, 5)]},
        {id: 3, actions: []},
      ],
    };
    const seeds = {train: 10, validation: 1000, test: 2000, stride: 100};
    const finite = loc('finite');
    await run(
      'experiment.mjs',
      'run',
      write('plan.json', {
        schema: 1,
        name: 'exact-ties',
        games: [{id: 'finite', limit: 2, definition: world}],
        arms: [{id: 'q', method: 'q_learning', epsilon: 0}],
        replicates: 1,
        checkpoints: [0],
        validationEpisodes: 1,
        testEpisodes: 2,
        seeds,
      }),
      finite,
      '--bend',
      bend,
    );
    const trace = await episode(finite, 'finite', 'q', 0);
    const secondTrace = await episode(finite, 'finite', 'q', 1);
    assert.deepEqual(
      trace.frames.map((f) => f.action),
      [first, 9],
    );
    assert.deepEqual(
      secondTrace.frames.map((f) => f.action),
      [first, 9],
    );
    assert.deepEqual(trace.frames[0].legal, [first, alternate]);
    assert.equal(trace.score, -4);

    await t.test('frozen-values uses the archived preferred action, not a random tie', async () => {
      const result = await run('studies/complex-worlds/frozen-values.mjs', finite);
      const [header, row] = result.stdout.trim().split(/\r?\n/);
      const data = Object.fromEntries(header.split(',').map((k, i) => [k, row.split(',')[i]]));
      assert.equal(data.arm, 'q');
      assert.equal(Number(data.budget), 0);
      assert.equal(Number(data.exact_return), trace.score);
      assert.equal(Number(data.return_sd), 0);
      assert.equal(Number(data.terminal_probability), 1);
    });

    await t.test(
      'explainDecisions reports the actual tied-policy action, not the oracle choice',
      () => {
        const report = explainDecisions(world, 2, trace.frames);
        assert.deepEqual(
          report.decisions.map((d) => d.action),
          trace.frames.map((f) => f.action),
        );
        assert.deepEqual(
          [
            report.decisions[0].bestAction,
            report.decisions[0].chosenValue,
            report.decisions[0].gap,
          ],
          [alternate, trace.score, 9],
        );
      },
    );

    const logs = loc('logs');
    await run(
      'batch.mjs',
      'collect',
      finite,
      write('logger.json', {
        schema: 1,
        name: 'exact-ties-logs',
        game: 'finite',
        arm: 'q',
        checkpoint: 0,
        epsilon: 1,
        fitEpisodes: 24,
        holdoutEpisodes: 8,
        seeds: {fit: 3000, holdout: 4000, stride: 100},
      }),
      logs,
    );
    const fit = openDataset(logs).episodes('fit', 0);
    const holdout = openDataset(logs).episodes('holdout', 0);

    await t.test('logged preferred action matches evaluation even when collection explores', () => {
      assert.ok(fit.some((ep) => ep.frames[0].action === alternate));
      assert.ok(fit.some((ep) => ep.frames[0].action === first));
      for (const ep of [...fit, ...holdout]) {
        assert.deepEqual(ep.frames[0].legal, trace.frames[0].legal);
        assert.equal(ep.frames[0].preferred, trace.frames[0].action);
        assert.equal(ep.frames[0].propensityBuckets, 32768);
      }
    });

    await t.test(
      'off-policy scoring target matches the compiled Evaluate-mode rollout',
      async () => {
        // Both moves were observed, share immediate reward zero, and gamma=0.
        assert.ok([first, alternate].every((a) => fit.some((ep) => ep.frames[0].action === a)));
        assert.ok(fit.every((ep) => ep.frames[0].reward === 0));
        const models = loc('models'),
          scored = loc('scores');
        await run(
          'batch.mjs',
          'fit',
          logs,
          write('fit.json', {
            schema: 1,
            name: 'exact-ties-fit',
            arms: [{id: 'fitted', method: 'fitted_q', iterations: 1, gamma: 0}],
          }),
          models,
          '--bend',
          bend,
        );
        await run(
          'batch.mjs',
          'score',
          finite,
          logs,
          models,
          write('score.json', {
            schema: 1,
            name: 'exact-ties-score',
            episodes: 3,
            seeds: {start: 5000, stride: 100},
          }),
          scored,
        );
        const result = json(path.join(scored, 'trials', 'fitted', '0.json')).body;
        assert.equal(result.exact_value, trace.score);
        assert.equal(result.sum, 3 * trace.score); // batch score runs the archived offline adapter
        assert.equal(result.coverage_complete, true);
      },
    );

    await t.test('arena tournament self-play matches a tied greedy rollout', async () => {
      const source = json(path.join(repo, 'experiments/two-pile-nim.json'));
      source.games[0].worldFile = path.join(repo, 'worlds/two-pile-nim.bend');
      const arm = source.arms.find((a) => a.id === 'negamax-q');
      arm.agentFile = path.join(repo, 'agents/self_play/agent.bend');
      const arena = loc('arena'),
        tournament = loc('tournament');
      await run(
        'experiment.mjs',
        'run',
        write('arena.json', {
          ...source,
          arms: [arm],
          replicates: 1,
          checkpoints: [0],
          validationEpisodes: 1,
          testEpisodes: 2,
        }),
        arena,
        '--bend',
        bend,
      );
      const match = await episode(arena, 'nim', arm.id, 0);
      const second = await episode(arena, 'nim', arm.id, 1);
      assert.deepEqual(
        match.frames.map((f) => f.action),
        match.frames.map((f) => f.legal[0]),
      );
      assert.deepEqual(
        match.frames.map((f) => f.action),
        second.frames.map((f) => f.action),
      );
      await run('analysis/arena_tournament.mjs', arena, tournament);
      const csv = fs.readFileSync(path.join(tournament, 'crossplay.csv'), 'utf8');
      const [, row] = csv.trim().split(/\r?\n/);
      assert.equal(Number(row.split(',').at(-1)), match.score);

      // Prove this setup distinguishes another tie convention, rather than
      // passing merely because every legal opening yields the same payoff.
      const {world: g, parameters} = json(path.join(arena, 'run.json')).body.plan.games[0];
      const api = (await import(pathToFileURL(path.join(arena, 'code/backend.mjs')).href)).default;
      const graph = gameGraph(api[g.entry + ':world'](parameterList(parameters)), 5);
      const firstLegal = graph.nodes.map((n) => (n.edges.length ? 0 : null));
      const otherOpening = [...firstLegal];
      otherOpening[graph.root] = 1;
      assert.equal(unpack(graph.nodes[graph.root].view.actions)[0], match.frames[0].action);
      assert.notEqual(matchup(graph, otherOpening, firstLegal), match.score);
    });
  },
);
