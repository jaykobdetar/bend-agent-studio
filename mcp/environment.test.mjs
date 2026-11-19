import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {numberPreservingJson} from '../core/finite_world.mjs';
import {compilerTest} from '../checks/support.mjs';
import {context} from './context.mjs';
import {environmentSessions} from './environment.mjs';
import {Client} from './wire-client.test-helper.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-env-test-'));
  const root = path.join(temp, 'workspace');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  return {
    temp,
    root,
    ctx: context(root),
    put: (file, value) => {
      fs.writeFileSync(path.join(root, file), numberPreservingJson(value));
    },
  };
}

const loops = {
  schema: 1,
  initial: [{to: 100, weight: 1}],
  states: [
    {id: 100, observation: 1, actions: [{id: 7, outcomes: [{to: 100, weight: 1, reward: -0}]}]},
  ],
};

test('sessions are per-store and per-world, bounded by count and absolute lifetime', (t) => {
  const {ctx, put} = fixture(t);
  for (const name of ['one.json', 'two.json', 'three.json']) put(name, loops);
  let time = 0;
  const sessions = environmentSessions({now: () => time, ttl: 10, serverCap: 3, worldCap: 2});
  const other = environmentSessions({now: () => time});
  const make = (world, seed = 0) => sessions.reset({world, seed}, ctx);
  const first = make('one.json');
  const second = make('./one.json');
  assert.notEqual(first.session, second.session);
  assert.deepEqual(Object.keys(first).sort(), ['legal', 'observation', 'session', 'terminal']);
  assert.deepEqual(first.legal, [7]);
  assert.throws(() => make('one.json'), /capacity/);
  time = 3;
  make('two.json');
  assert.throws(() => make('three.json'), /capacity/);
  const args = {world: 'one.json', session: first.session, action: 7};
  assert.throws(() => sessions.step({...args, world: 'two.json'}, ctx), /no active/);
  assert.throws(() => other.step(args, ctx), /no active/);
  time = 8;
  put('one.json', {
    schema: 1,
    initial: [{to: 200, weight: 1}],
    states: [{id: 200, observation: 2, actions: []}],
  });
  const accepted = sessions.step(args, ctx);
  assert.equal(accepted.frame.reward, -0);
  time = 10;
  assert.throws(() => sessions.step(args, ctx), /no active/);
  assert.equal(sessions.prune(), 1);
  make('three.json');
});

test('invalid, terminal and truncated actions expose only the engine public view', (t) => {
  const {ctx, put} = fixture(t);
  put('world.json', loops);
  put('end.json', {
    schema: 1,
    initial: [{to: 9, weight: 1}],
    states: [{id: 9, observation: 3, actions: []}],
  });
  const sessions = environmentSessions();
  assert.deepEqual(sessions.reset({world: 'end.json', seed: 0xffffffff}, ctx), {
    observation: 3,
    legal: [],
    terminal: true,
    session: null,
  });
  for (const seed of [0x100000000, -1, 0.5])
    assert.throws(() => sessions.reset({world: 'world.json', seed}, ctx), /invalid U32 seed/);
  const {session} = sessions.reset({world: 'world.json', seed: 42, limit: 1}, ctx);
  const a = {world: 'world.json', session, action: 7};
  assert.throws(() => sessions.step({...a, action: -1}, ctx), /invalid U32/);
  assert.deepEqual(sessions.step(a, ctx), {
    done: true,
    frame: {
      observation: 1,
      legal: [7],
      action: 7,
      accepted: true,
      reward: -0,
      nextObservation: 1,
      nextLegal: [7],
      terminal: false,
      truncated: true,
    },
  });
  assert.throws(() => sessions.step(a, ctx), /no active/);
  a.session = sessions.reset({world: 'world.json', seed: 42}, ctx).session;
  assert.deepEqual(sessions.step({...a, action: 100}, ctx), {
    done: true,
    frame: {
      observation: 1,
      legal: [7],
      action: 100,
      accepted: false,
    },
  });
  assert.throws(() => sessions.step(a, ctx), /no active/);
});

function data(response) {
  assert.ok(!response.error && !response.result.isError, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
}

test('stdio environment tools have no file writes and enforce workspace data-only inputs', async (t) => {
  const {root, temp, put} = fixture(t);
  put('world.json', loops);
  put('grid.json', {schema: 1, grid: ['SG'], goalReward: 0.25});
  put('huge-grid.json', {schema: 1, grid: ['S'.repeat(4097)]});
  put('broken.json', {schema: 1, states: []});
  put('code.bend', loops);
  fs.writeFileSync(path.join(root, 'oversized.json'), ' '.repeat(2 ** 20 + 1));
  fs.writeFileSync(path.join(temp, 'outside.json'), numberPreservingJson(loops));
  if (process.platform !== 'win32')
    fs.symlinkSync(path.join(temp, 'outside.json'), path.join(root, 'link.json'));
  const client = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', root]);
  t.after(() => client.close());
  await client.init();
  const before = fs.readdirSync(root);
  const listed = (await client.rpc('tools/list')).result.tools;
  for (const name of ['env_reset', 'env_step']) {
    const definition = listed.find((x) => x.name === name);
    assert.ok(definition);
    assert.equal(definition.annotations.openWorldHint, false);
  }
  for (const world of [
    '../outside.json',
    'code.bend',
    'broken.json',
    'huge-grid.json',
    'oversized.json',
    ...(process.platform === 'win32' ? [] : ['link.json']),
  ]) {
    const rejected = await client.call('env_reset', {world, seed: 0});
    assert.equal(rejected.result.isError, true, JSON.stringify(rejected));
  }
  const {session} = data(await client.call('env_reset', {world: 'world.json', seed: 0}));
  assert.match(session, /^[0-9a-f]{48}$/);
  const wrongWorld = await client.call('env_step', {world: 'grid.json', session, action: 1});
  assert.equal(wrongWorld.result.isError, true);
  const valid = data(await client.call('env_step', {world: 'world.json', session, action: 7}));
  assert.equal(valid.frame.reward, -0);
  const grid = data(await client.call('env_reset', {world: 'grid.json', seed: 0, limit: 1}));
  assert.deepEqual(grid.legal, [1]);
  const moved = data(
    await client.call('env_step', {world: 'grid.json', session: grid.session, action: 1}),
  );
  assert.equal(moved.frame.reward, 0.25);
  assert.equal(moved.frame.terminal, true);
  assert.equal(moved.frame.truncated, false);
  assert.deepEqual(fs.readdirSync(root), before);
});

test(
  'literal and packed finite env frames equal real Bend replay over stochastic seeds',
  compilerTest,
  async (t) => {
    const {root, put} = fixture(t);
    const cli = (...args) =>
      execFileSync(process.execPath, [path.join(repo, 'experiment.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30000,
      });
    const common = {
      schema: 1,
      initial: [
        {to: 77, weight: 3},
        {to: 88, weight: 7},
      ],
      states: [
        {
          id: 77,
          observation: 1001,
          actions: [
            {
              id: 17,
              outcomes: [
                {to: 77, weight: 2, reward: -0.3},
                {to: 88, weight: 3, reward: 0.1},
                {to: 99, weight: 5, reward: 0.7},
              ],
            },
          ],
        },
        {
          id: 88,
          observation: 2002,
          actions: [
            {
              id: 29,
              outcomes: [
                {to: 77, weight: 2, reward: -0.4},
                {to: 88, weight: 5, reward: 0.6},
                {to: 99, weight: 3, reward: 0.8},
              ],
            },
          ],
        },
        {id: 99, observation: 3003, actions: []},
      ],
    };
    put('literal.json', common);
    put('packed.json', {
      ...common,
      states: [
        ...common.states,
        ...Array.from({length: 125}, (_, i) => ({id: i + 10000, observation: 3003, actions: []})),
      ],
    });
    const limit = 3;
    put('plan.json', {
      schema: 1,
      name: 'env-check',
      games: ['literal', 'packed'].map((id) => ({
        id,
        file: id + '.json',
        limit,
      })),
      arms: [{id: 'random', method: 'random'}],
      replicates: 1,
      checkpoints: [0],
      validationEpisodes: 12,
      testEpisodes: 0,
      seeds: {train: 1, validation: 0xffffff00, test: 500, stride: 16},
    });
    cli('run', 'plan.json', 'archive');
    cli('verify', 'archive');
    const seen = {first: new Set(), reward: new Set(), ends: new Set()};
    const client = new Client(path.join(repo, 'mcp/server.mjs'), ['--workspace', root]);
    t.after(() => client.close());
    await client.init();
    for (const world of ['literal', 'packed'])
      for (let i = 0; i < 12; i++) {
        const replay = JSON.parse(
          cli('replay', 'archive', world, 'random', '0', '0', 'validation', String(i)),
        );
        const file = world + '.json';
        const {session, observation, legal} = data(
          await client.call('env_reset', {world: file, seed: replay.seed, limit}),
        );
        assert.equal(observation, replay.frames[0].observation);
        assert.deepEqual(legal, replay.frames[0].legal);
        seen.first.add(observation);
        for (const [j, expected] of replay.frames.entries()) {
          const {frame, done} = data(
            await client.call('env_step', {world: file, session, action: expected.action}),
          );
          assert.deepEqual(frame, expected);
          assert.equal(done, j === replay.frames.length - 1);
          seen.reward.add(frame.reward);
          if (done) seen.ends.add(frame.terminal ? 'terminal' : 'truncated');
        }
      }
    assert.equal(seen.first.size, 2);
    assert.ok(seen.reward.size >= 4);
    assert.deepEqual([...seen.ends].sort(), ['terminal', 'truncated']);
  },
);
