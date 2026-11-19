import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from './wire-client.test-helper.mjs';
import {seal} from '../core/experiment.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
function data(response) {
  assert.ok(!response.error, JSON.stringify(response.error));
  assert.ok(!response.result.isError, JSON.stringify(response.result));
  return response.result.structuredContent ?? JSON.parse(response.result.content[0].text);
}
function failed(r) {
  return Boolean(r.error || r.result?.isError);
}
test('stdio handshake, capability discovery, resource, oracle, error isolation, and orderly EOF', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-mcp-wire-'));
  const root = path.join(tmp, 'ws');
  await fs.mkdir(root);
  const world = path.join(repo, 'worlds/bridge.json');
  await fs.copyFile(world, path.join(root, 'bridge.json'));
  await fs.copyFile(world, path.join(tmp, 'outside.json'));
  const cl = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', root]);
  t.after(async () => {
    if (cl.child.exitCode === null && cl.child.signalCode === null) await cl.close();
    await fs.rm(tmp, {recursive: true, force: true});
  });
  const init = await cl.init();
  assert.ok(init.result?.capabilities.tools);
  assert.ok(init.result?.capabilities.resources);
  const listed = (await cl.rpc('tools/list')).result.tools,
    byName = Object.fromEntries(listed.map((x) => [x.name, x]));
  for (const name of [
    'validate_plan',
    'validate_world',
    'solve_world',
    'start_run',
    'job_status',
    'cancel_job',
    'summarize_results',
    'replay_episode',
    'explain_episode',
  ])
    assert.ok(byName[name], name);
  for (const name of ['summarize_results', 'replay_episode', 'explain_episode'])
    assert.equal(byName[name].annotations.readOnlyHint, true);
  const resources = (await cl.rpc('resources/list')).result.resources;
  assert.ok(resources.length >= 4);
  for (const {uri} of resources)
    assert.ok((await cl.rpc('resources/read', {uri})).result.contents[0].text.length, uri);
  assert.ok(failed(await cl.call('validate_world', {world: '../outside.json'})));
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(tmp, 'outside.json'), path.join(root, 'link.json'));
    assert.ok(failed(await cl.call('validate_world', {world: 'link.json'})));
  }
  assert.ok(failed(await cl.call('validate_world', {world: 'bridge.json', unknown: true})));
  assert.ok(failed(await cl.call('unknown_command', {})));
  const v = data(await cl.call('validate_world', {world: 'bridge.json'}));
  assert.equal(v.states, 4);
  for (const kind of ['full', 'reactive', 'history', 'clock']) {
    const result = data(await cl.call('solve_world', {world: 'bridge.json', horizon: 2, kind}));
    assert.ok(Object.values(result).includes(2), kind);
  }
  assert.deepEqual(cl.invalid, []);
  const exit = await cl.close();
  assert.equal(exit.code, 0, cl.stderr);
});

for (const stop of ['EOF', 'SIGKILL'])
  test(
    'MCP ' + stop + ' kills the active training compiler and its descendant',
    {skip: process.platform === 'win32' ? 'POSIX compiler shim' : false, timeout: 45000},
    async (t) => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-mcp-shutdown-'));
      t.after(() => fs.rm(tmp, {recursive: true, force: true}));
      const plan = JSON.parse(await fs.readFile(path.join(repo, 'experiments/bridge.json')));
      plan.games[0].file = 'bridge.json';
      await fs.copyFile(path.join(repo, 'worlds/bridge.json'), path.join(tmp, 'bridge.json'));
      await fs.writeFile(path.join(tmp, 'plan.json'), JSON.stringify(plan));
      const shim = path.join(tmp, 'compiler'),
        ready = path.join(tmp, 'ready'),
        marker = path.join(tmp, 'marker');
      await fs.writeFile(
        shim,
        `#!${process.execPath}
const fs=require('node:fs'),{spawn}=require('node:child_process');
if(process.argv[2]==='version')console.log('bend 2.0.40');
else {
  spawn(process.execPath,['-e',"const fs=require('node:fs');fs.writeFileSync(process.env.READY,'ready');setTimeout(()=>fs.writeFileSync(process.env.MARKER,'orphan'),1500)"],{stdio:'ignore'});
  setInterval(()=>{},10000);
}`,
        {mode: 0o700},
      );
      const client = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', tmp], {
        env: {...process.env, BEND: shim, READY: ready, MARKER: marker},
      });
      t.after(async () => {
        if (client.child.exitCode === null && client.child.signalCode === null) await client.close();
      });
      await client.init();
      data(await client.call('start_run', {plan: 'plan.json', out: 'run'}));
      for (let i = 0; i < 500; i++) {
        try {
          await fs.access(ready);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      assert.equal(await fs.readFile(ready, 'utf8'), 'ready');
      if (stop === 'EOF') assert.equal((await client.close()).code, 0, client.stderr);
      else {
        assert.ok(client.child.kill('SIGKILL'));
        assert.equal((await client.closed).signal, 'SIGKILL');
      }
      await new Promise((r) => setTimeout(r, 1700));
      await assert.rejects(fs.access(marker), {code: 'ENOENT'});
    },
  );

test('MCP scaffolds and sweep use confined, no-clobber workspace paths', async (t) => {
  const temp = path.parse(repo).root.toLowerCase() === path.parse(os.tmpdir()).root.toLowerCase()
    ? os.tmpdir() : repo;
  const tmp = await fs.mkdtemp(path.join(temp, 'bend-mcp-scaffold-'));
  const root = path.join(tmp, 'workspace');
  const outside = path.join(tmp, 'outside');
  await Promise.all([fs.mkdir(root), fs.mkdir(outside)]);
  const cl = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', root]);
  t.after(async () => {
    await cl.close();
    await fs.rm(tmp, {recursive: true, force: true});
  });
  await cl.init();
  const byName = Object.fromEntries((await cl.rpc('tools/list')).result.tools.map(x => [x.name, x]));
  for (const name of ['init_agent', 'init_world', 'init_plan', 'sweep'])
    assert.equal(byName[name].annotations.readOnlyHint, false);
  assert.ok(failed(await cl.call('init_plan', {name: '../outside/forbidden'})));
  if (process.platform !== 'win32') {
    const linked = path.join(root, 'worlds');
    await fs.symlink(outside, linked, 'dir');
    assert.ok(failed(await cl.call('init_world', {name: 'forbidden'})));
    await fs.unlink(linked);
  }
  assert.equal(data(await cl.call('init_world', {name: 'finite'})).created.length, 1);
  assert.equal(data(await cl.call('init_world', {name: 'bend', bend: true})).created.length, 1);
  assert.equal(data(await cl.call('init_agent', {name: 'starter'})).created.length, 6);
  assert.equal(data(await cl.call('validate_plan', {plan: 'agents/starter/example.json'})).trialCount, 1);
  assert.equal(data(await cl.call('init_plan', {name: 'screen'})).created.length, 1);
  assert.ok(failed(await cl.call('init_plan', {name: 'screen'})));
  const source = path.join(root, 'experiments/screen.json');
  const modified = JSON.parse(await fs.readFile(source));
  modified.arms = [{id: 'q', method: 'q_learning'}];
  await fs.writeFile(source, JSON.stringify(modified));
  const spec = {schema: 1, plan: 'experiments/screen.json', arm: 'q', grid: {alpha: [0.1, 0.2]}};
  await fs.writeFile(path.join(root, 'spec.json'), JSON.stringify(spec));
  assert.ok(failed(await cl.call('sweep', {spec: 'spec.json', out: '../outside/forbidden.json'})));
  assert.equal(data(await cl.call('sweep', {spec: 'spec.json', out: 'output.json'})).arms, 2);
  assert.ok(failed(await cl.call('sweep', {spec: 'spec.json', out: 'output.json'})));
  const validated = data(await cl.call('validate_plan', {plan: 'output.json'}));
  assert.equal(validated.plan.testEpisodes, 0);
  assert.equal(validated.trialCount, 2);
  modified.checkpoints = [0, 2, 4];
  await fs.writeFile(source, JSON.stringify(modified));
  await fs.writeFile(path.join(root, 'spec.json'),
    JSON.stringify({...spec, halving: {checkpoints: [2, 4]}}));
  assert.equal(data(await cl.call('sweep', {spec: 'spec.json', out: 'half-plan.json'})).arms, 2);
  const half = data(await cl.call('validate_plan', {plan: 'half-plan.json'})).plan;
  await fs.mkdir(path.join(root, 'partial'));
  await fs.writeFile(path.join(root, 'partial/run.json'), seal({plan: half}));
  assert.ok(failed(await cl.call('sweep', {
    spec: 'spec.json', out: 'forbidden.json', halvingRun: '../outside',
  })));
  const next = data(await cl.call('sweep', {
    spec: 'spec.json', out: 'rung.json', halvingRun: 'partial',
  }));
  assert.deepEqual(next.next.map(x => [x.shard, x.until]), [['0/2', 2], ['1/2', 2]]);
  await fs.writeFile(path.join(outside, 'source.json'), JSON.stringify(modified));
  await fs.writeFile(path.join(root, 'spec.json'),
    JSON.stringify({...spec, plan: '../outside/source.json'}));
  assert.ok(failed(await cl.call('sweep', {spec: 'spec.json', out: 'forbidden.json'})));
  await assert.rejects(fs.stat(path.join(root, 'forbidden.json')), {code: 'ENOENT'});
  await assert.rejects(fs.stat(path.join(outside, 'forbidden.json')), {code: 'ENOENT'});
  assert.deepEqual(cl.invalid, []);
});
