import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {Client} from './wire-client.test-helper.mjs';
import {compilerTest} from '../checks/support.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
test(
  'an MCP-only client authors a world and plan in an empty workspace and inspects its learned policy',
  {...compilerTest, timeout: 90000},
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-inline-loop-'));
    const cl = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', dir]);
    await cl.init();
    t.after(async () => {
      await cl.close();
      await fs.rm(dir, {recursive: true, force: true});
    });
    const call = async (name, a) => {
      const r = (await cl.call(name, a)).result;
      assert.ok(r && !r.isError, JSON.stringify(r));
      return r.structuredContent;
    };
    const fail = async (name, a) => {
      const r = (await cl.call(name, a)).result;
      assert.ok(r?.isError, JSON.stringify(r));
      return r.structuredContent.error;
    };
    // Only the MCP is allowed to write to the initially empty directory.
    const world = {
      schema: 1,
      initial: [{to: 0, weight: 1}],
      states: [
        {
          id: 0,
          actions: [
            {id: 0, outcomes: [{to: 1, reward: -1, weight: 1}]},
            {id: 1, outcomes: [{to: 1, reward: 3, weight: 1}]},
          ],
        },
        {id: 1, actions: []},
      ],
    };
    const w = await call('validate_world', {world});
    assert.equal(w.states, 2);
    assert.deepEqual(w.terminalStates, [1]);
    for (const kind of ['full', 'reactive', 'history', 'clock']) {
      const zero = await call('solve_world', {world, horizon: 0, kind});
      assert.equal(zero.uniformReturn, 0);
      assert.equal(zero.optimalFullStateReturn, 0);
    }
    const empty = await call('evaluate_policy_exact', {world, horizon: 0, policy: {}});
    assert.equal(empty.expectedReturn, 0);
    assert.equal(empty.expectedSteps, 0);
    const oracle = await call('solve_world', {world, horizon: 1, kind: 'history'});
    assert.equal(oracle.uniformReturn, 1);
    assert.equal(oracle.optimalPublicHistoryReturn, 3);
    const plan = {
      schema: 1,
      name: 'from-scratch',
      games: [{id: 'decision', limit: 1, definition: world}],
      arms: [
        {id: 'random', method: 'random'},
        {id: 'q', method: 'q_learning'},
      ],
      replicates: 2,
      checkpoints: [0, 8],
      validationEpisodes: 2,
      testEpisodes: 2,
      seeds: {train: 10, validation: 1000, test: 10000, stride: 100},
    };
    const checked = await call('validate_plan', {plan});
    assert.equal(checked.trialCount, 4);
    await fail('validate_plan', {plan: {...plan, games: [{id: 'bad', limit: 1, file: 'world.json'}]}});
    assert.deepEqual(await fs.readdir(dir), [], 'validation and oracle must be side-effect-free');
    const start = await call('start_run', {plan, out: 'study'});
    let state;
    for (let i = 0; i < 300; i++) {
      state = await call('job_status', {jobId: start.jobId});
      if (state.status !== 'running') break;
      await wait(150);
    }
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'study/input-plan.json'))), plan);
    assert.match(await fail('start_run', {plan, out: 'study'}), /exists/);
    assert.match(await fail('start_run', {plan, out: '../elsewhere'}), /outside workspace/);
    const s = await call('summarize_results', {
      run: 'study',
      phase: 'test',
      reference: 'random',
      draws: 100,
    });
    assert.equal(s.rows.length, 1);
    const a = {
      run: 'study',
      game: 'decision',
      arm: 'q',
      replicate: 0,
      checkpoint: 8,
      phase: 'test',
      episode: 0,
    };
    const replay = await call('replay_episode', a),
      explained = await call('explain_episode', a);
    assert.equal(replay.total, 1);
    assert.equal(explained.decisions[0].gap, 3 - replay.score);
    assert.deepEqual(await fs.readdir(dir), ['study']);
    assert.deepEqual(cl.invalid, []);
  },
);
