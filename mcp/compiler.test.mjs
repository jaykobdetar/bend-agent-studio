import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {compilerTest} from '../checks/support.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
test(
  'SDK client: real Bend training, completion, paired summary, archived replay, finite explanation and cancellation',
  {...compilerTest, timeout: 120000},
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-mcp-real-'));
    t.after(() => fs.rm(dir, {recursive: true, force: true}));
    const plan = JSON.parse(await fs.readFile(path.join(repo, 'experiments/bridge.json')));
    Object.assign(plan, {replicates: 2, checkpoints: [0, 2], validationEpisodes: 2, testEpisodes: 2});
    plan.games[0].file = 'bridge.json';
    plan.arms = plan.arms.slice(0, 2);
    await fs.writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan));
    await fs.copyFile(path.join(repo, 'worlds/bridge.json'), path.join(dir, 'bridge.json'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'mcp/server.mjs'), '--workspace', dir],
      env: {...process.env},
      stderr: 'pipe',
    });
    const client = new Client({name: 'sdk-regression', version: '1.0'});
    t.after(() => client.close());
    await client.connect(transport);
    const rpc = (name, args) => client.callTool({name, arguments: args});
    const call = async (name, args) => {
      const r = await rpc(name, args);
      assert.ok(!r.isError, JSON.stringify(r.content));
      return r.structuredContent;
    };
    const v = await call('validate_plan', {plan: 'plan.json'});
    assert.equal(v.trialCount, 4);
    const j = await call('start_run', {plan: 'plan.json', out: 'run'});
    assert.equal(j.status, 'running');
    assert.equal((await rpc('start_run', {plan: 'plan.json', out: 'other'})).isError, true);
    let state;
    for (let i = 0; i < 300; i++) {
      state = await call('job_status', {jobId: j.jobId});
      if (state.status !== 'running') break;
      await delay(250);
    }
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(state.progress.completeTrials, 4);
    const s = await call('summarize_results', {
      run: 'run',
      phase: 'test',
      reference: 'random',
      draws: 100,
    });
    assert.equal(s.rows.length, 1);
    assert.equal(s.rows[0].replicates, 2);
    const annotation={notes:'Baseline <b>trial</b>',tags:['pilot']};
    await fs.writeFile(path.join(dir,'run','notes.json'),JSON.stringify(annotation));
    const verified = await call('verify_run', {run: 'run'});
    assert.equal(verified.verified, true);
    const listed = await call('list_runs', {root: '.'});
    assert.ok(listed.runs.some((x) => x.verified && x.complete && x.name === 'run'));
    assert.deepEqual(listed.runs.find(x=>x.name==='run').annotations,annotation);
    const curve = await call('learning_curve', {run: 'run', phase: 'validation', draws: 100});
    assert.ok(curve.series.some((s) => s.arm === 'q' && s.points.length >= 2));
    const checkpoint = await call('get_checkpoint', {
      run: 'run',
      game: 'bridge',
      arm: 'q',
      replicate: 0,
      checkpoint: 2,
    });
    assert.equal(checkpoint.model, undefined);
    assert.match(checkpoint.modelHash, /^[a-f0-9]{64}$/);
    const coords = {
      run: 'run',
      game: 'bridge',
      arm: 'q',
      replicate: 0,
      checkpoint: 2,
      phase: 'test',
      episode: 0,
      limit: 1,
    };
    const r = await call('replay_episode', coords);
    assert.equal(r.frames.length, 1);
    assert.equal(r.total, r.steps);
    const e = await call('explain_episode', coords);
    assert.equal(e.total, r.steps);
    assert.equal(e.decisions[0].action, r.frames[0].action);
    assert.equal((await rpc('start_run', {plan: 'plan.json', out: 'run'})).isError, true);
    await fs.appendFile(path.join(dir, 'run/code/experiment.mjs'), '\n// fixture: altered runner\n');
    assert.match((await rpc('replay_episode', coords)).structuredContent.error, /checksum/);
    const j2 = await call('start_run', {plan: 'plan.json', out: 'new'});
    const cancelled = await call('cancel_job', {jobId: j2.jobId});
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await call('job_status', {jobId: j2.jobId})).status, 'cancelled');
  },
);
