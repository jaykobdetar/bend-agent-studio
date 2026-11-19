import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {context, repo, serverContext} from './context.mjs';
import {inspection} from './inspection.mjs';
import {jobs} from './jobs.mjs';
import {more} from './more.mjs';
import {compilerTest} from '../checks/support.mjs';

const other = process.env.BEND_MCP_TEST_OTHER_NODE;
const backend = process.platform === 'win32' ? 'python' : 'python3';
function tiny(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-mcp-optional-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const plan = JSON.parse(fs.readFileSync(path.join(repo, 'experiments/bridge.json')));
  Object.assign(plan, {replicates: 2, checkpoints: [0, 1], testEpisodes: 2, validationEpisodes: 2});
  plan.games[0].file = 'bridge.json';
  fs.copyFileSync(path.join(repo, 'worlds/bridge.json'), path.join(dir, 'bridge.json'));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan));
  return dir;
}
test(
  'replay and resume with a different exact recorded Node executable',
  {
    ...compilerTest,
    skip:
      compilerTest.skip || (!other && 'set BEND_MCP_TEST_OTHER_NODE to another Node 24 executable'),
    timeout: 60000,
  },
  async (t) => {
    const dir = tiny(t),
      version = execFileSync(other, ['-p', 'process.versions.node'], {encoding: 'utf8'}).trim();
    assert.notEqual(version, process.versions.node, 'supply a genuinely different Node version');
    execFileSync(
      other,
      [path.join(repo, 'experiment.mjs'), 'run', 'plan.json', 'run', '--until', '0'],
      {
        cwd: dir,
        timeout: 30000,
      },
    );
    const ctx = serverContext(dir, {[version]: other});
    const j = await jobs.resume_run.run({run: 'run'}, ctx);
    let state;
    do {
      await new Promise((r) => setTimeout(r, 100));
      state = await jobs.job_status.run({jobId: j.jobId}, ctx);
    } while (state.status === 'running');
    assert.equal(state.status, 'completed', state.lastStderr);
    const r = await inspection.replay_episode.run(
      {
        run: 'run',
        game: 'bridge',
        arm: 'q',
        replicate: 0,
        checkpoint: 1,
        phase: 'test',
        episode: 0,
      },
      ctx,
    );
    assert.ok(r.steps);
    assert.equal(r.steps, r.total);
  },
);
test(
  'optional matplotlib renders an actual SVG and refuses overwrite',
  {
    ...compilerTest,
    skip:
      compilerTest.skip ||
      spawnSync(backend, ['-I', '-c', 'import matplotlib'], {stdio: 'ignore', timeout: 10000})
        .status !== 0,
    timeout: 60000,
  },
  async (t) => {
    const dir = tiny(t);
    execFileSync(process.execPath, [path.join(repo, 'experiment.mjs'), 'run', 'plan.json', 'run'], {
      cwd: dir,
      timeout: 30000,
    });
    const ctx = context(dir),
      args = {run: 'run', draws: 100, svgOut: 'figure'};
    const r = await more.learning_curve.run(args, ctx);
    assert.ok(r.series.length);
    assert.match(fs.readFileSync(path.join(dir, r.svg), 'utf8'), /<svg\b/);
    await assert.rejects(more.learning_curve.run(args, ctx), /already exists/);
  },
);
