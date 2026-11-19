import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from './wire-client.test-helper.mjs';
import {seal, stats} from '../core/experiment.mjs';
import {digest} from '../core/experiment_config.mjs';
import {compilerTest} from '../checks/support.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-boundary-')),
    root = path.join(tmp, 'workspace');
  await fs.mkdir(root);
  const client = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', root]);
  await client.init();
  t.after(async () => {
    await client.close();
    await fs.rm(tmp, {recursive: true, force: true});
  });
  const call = async (name, a) => {
    const r = (await client.call(name, a)).result;
    assert.ok(r && !r.isError, JSON.stringify(r));
    return r.structuredContent;
  };
  const error = async (name, a) => {
    const r = (await client.call(name, a)).result;
    assert.ok(r?.isError, JSON.stringify(r));
    return r.structuredContent.error;
  };
  return {tmp, root, client, call, error};
}
test('nested plan/world/agent inputs must stay in the workspace; output parent must be local and new', async (t) => {
  const {tmp, root, call, error} = await fixture(t),
    plan = JSON.parse(await fs.readFile(path.join(repo, 'experiments/bridge.json')));
  await fs.mkdir(path.join(root, 'plans'));
  await fs.copyFile(path.join(repo, 'worlds/bridge.json'), path.join(tmp, 'outside.json'));
  const planFile = path.join(root, 'plans/plan.json'),
    request = {plan: 'plans/plan.json'};
  await fs.writeFile(
    path.join(root, 'invalid-plan.json'),
    JSON.stringify({schema: 1, name: 'bad', games: {}}),
  );
  assert.equal(
    await error('validate_plan', {plan: 'invalid-plan.json'}),
    'games must be a nonempty list',
  );
  plan.games[0].file = '../../outside.json';
  await fs.writeFile(planFile, JSON.stringify(plan));
  assert.match(await error('validate_plan', request), /outside workspace/i);
  await fs.copyFile(path.join(tmp, 'outside.json'), path.join(root, 'world.json'));
  plan.games[0].file = '../world.json';
  await fs.writeFile(planFile, JSON.stringify(plan));
  assert.equal((await call('validate_plan', request)).plan.name, plan.name);
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(tmp, 'outside.json'), path.join(root, 'world-link.json'));
    plan.games[0].file = '../world-link.json';
    await fs.writeFile(planFile, JSON.stringify(plan));
    assert.match(await error('validate_plan', request), /link/i);
    await fs.symlink(tmp, path.join(root, 'out-link'));
    assert.match(await error('start_run', {...request, out: 'out-link/new-run'}), /link/i);
  }
  plan.games[0].file = '../world.json';
  await fs.writeFile(path.join(tmp, 'outside-helper.bend'), 'import Base\n');
  await fs.writeFile(path.join(root, 'plans/helper.bend'), 'import ../../outside-helper.bend as H\n');
  await fs.writeFile(path.join(root, 'plans/agent.bend'), 'import ./helper.bend as H\n');
  plan.arms = [{id: 'custom', method: 'custom', agentFile: 'agent.bend'}];
  await fs.writeFile(planFile, JSON.stringify(plan));
  assert.match(await error('validate_plan', request), /outside workspace/i);
  assert.match(await error('start_run', {...request, out: 'plans'}), /already exists/i);
});
test('MCP plan validation reports built-in, finishing and contextual hook choices', async (t) => {
  const {root, call, error} = await fixture(t);
  const plan = JSON.parse(await fs.readFile(path.join(repo, 'experiments/bridge.json')));
  const finish = 'def finish(m: U32) -> U32: m\n';
  const context = 'def learn_context(m: U32) -> U32: m\n';
  const write = (name, contents) => fs.writeFile(path.join(root, name), contents);
  await write('world.json', await fs.readFile(path.join(repo, 'worlds/bridge.json')));
  await write('finishing.bend', finish);
  await write('contextual.bend', finish + context);
  plan.games[0].file = 'world.json';
  plan.arms = [{id:'q',method:'q_learning'}, {id:'f',method:'custom',agentFile:'finishing.bend'},
    {id:'c',method:'custom',agentFile:'contextual.bend'}];
  await write('plan.json', JSON.stringify(plan));
  const checked = await call('validate_plan', {plan:'plan.json'});
  assert.deepEqual(checked.armHooks, [
    {arm:'q',hook:'Hooks'}, {arm:'f',hook:'Finishing'}, {arm:'c',hook:'Contextual'},
  ]);
  assert.ok(checked.plan.arms.every(arm => !Object.hasOwn(arm, 'hook')));
  await write('contextual.bend', context);
  assert.equal(await error('validate_plan', {plan:'plan.json'}), 'arm c: learn_context requires finish');
});

test('step-checkpoint inspection hides cursor state and rejects oversized opt-in models without breaking other calls', async (t) => {
  const {root, client, call, error} = await fixture(t),
    dir = path.join(root, 'run');
  await fs.mkdir(path.join(dir, 'code'), {recursive: true});
  const body = '// inert checkpoint fixture\n';
  for (const f of ['experiment.mjs', 'backend.mjs']) await fs.writeFile(path.join(dir, 'code', f), body);
  const p = {
    name: 'smoke',
    games: [{id: 'bridge'}],
    arms: [{id: 'q'}],
    replicates: 1,
    checkpoints: [0, 1, 2],
    budgetUnit: 'steps',
  };
  const manifest = seal({
    plan: p,
    toolchain: {
      sources: {'experiment.mjs': digest(body)},
      backend: digest(body),
      node: process.versions.node,
    },
  });
  await fs.writeFile(path.join(dir, 'run.json'), manifest);
  const folder = path.join(dir, 'trials/bridge/q/0');
  await fs.mkdir(folder, {recursive: true});
  let parent = null,
    deep = 0;
  for (let i = 0; i < 9000; i++) deep = [deep];
  for (const n of p.checkpoints) {
    const row = seal({
      experiment: JSON.parse(manifest).hash,
      parent,
      game: 'bridge',
      arm: 'q',
      rep: 0,
      episodes: n,
      started: 1,
      model: n === 2 ? deep : {data: n ? 'x'.repeat(132 * 1024) : 'small', signedZero: -0},
      partial: n ? {steps: 1, score: 0, cursor: {hidden: 'not-an-output'}} : null,
      train: stats(),
      validation: stats(),
      test: null,
    });
    await fs.writeFile(path.join(folder, n + '.json'), row);
    parent = JSON.parse(row).hash;
  }
  const a = {run: 'run', game: 'bridge', arm: 'q', replicate: 0, checkpoint: 1};
  const r = await call('get_checkpoint', a);
  assert.deepEqual(r.partial, {steps: 1, score: 0});
  assert.ok(!('model' in r));
  assert.ok(!('modelCanonical' in r));
  assert.match(r.modelHash, /^[a-f0-9]{64}$/);
  assert.match(await error('get_checkpoint', {...a, includeModel: true}), /128 KiB/);
  const full = await call('get_checkpoint', {...a, checkpoint: 0, includeModel: true});
  assert.equal(full.model.data, 'small');
  assert.equal(digest(full.modelCanonical), full.modelHash);
  assert.ok(Object.is(JSON.parse(full.modelCanonical).signedZero, -0));
  const nested = await call('get_checkpoint', {...a, checkpoint: 2, includeModel: true});
  assert.equal(nested.model, undefined);
  assert.equal(digest(nested.modelCanonical), nested.modelHash);
  const copy = JSON.parse(manifest).body;
  copy.plan.checkpoints = [0, -1];
  await fs.writeFile(path.join(dir, 'run.json'), seal(copy));
  assert.match(await error('get_checkpoint', a), /dimensions/);
  const healthy = await client.rpc('ping');
  assert.deepEqual(healthy.result, {});
});

test(
  'a burst of progress polls does not block protocol ping or cancellation',
  {...compilerTest, timeout: 45000},
  async (t) => {
    const {root, client, call} = await fixture(t);
    const p = JSON.parse(await fs.readFile(path.join(repo, 'experiments/bridge.json')));
    Object.assign(p, {replicates: 1, checkpoints: [0, 1000000], validationEpisodes: 1, testEpisodes: 1});
    p.games[0].file = 'world.json';
    await fs.copyFile(path.join(repo, 'worlds/bridge.json'), path.join(root, 'world.json'));
    await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify(p));
    const j = await call('start_run', {plan: 'plan.json', out: 'long'});
    const manifest = path.join(root, 'long/run.json');
    let ready = false;
    for (let i = 0; i < 300; i++) {
      try {
        await fs.access(manifest);
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 75));
      }
    }
    assert.ok(ready, 'training produced its initial manifest');
    const order = [];
    const polls = Array.from({length: 8}, () =>
      call('job_status', {jobId: j.jobId}).then((r) => {
        order.push('poll');
        return r;
      }),
    );
    const ping = client.rpc('ping').then((r) => {
      order.push('ping');
      assert.deepEqual(r.result, {});
    });
    const stopped = call('cancel_job', {jobId: j.jobId});
    await Promise.all([ping, ...polls]);
    assert.equal((await stopped).status, 'cancelled');
    assert.equal(order[0], 'ping', 'protocol remains responsive during asynchronous validation');
    const final = await call('job_status', {jobId: j.jobId});
    assert.equal(final.status, 'cancelled');
    assert.ok(final.progress.totalCheckpoints > 0);
  },
);
