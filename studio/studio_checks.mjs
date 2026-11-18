import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { worlds } from './catalog.mjs';
import { boardStates, observation } from './web/scene.js';
import { timeline } from './web/exporter.js';
import { Gif } from './web/gif.js';

async function demo(id) {
  return JSON.parse(await readFile(new URL('./web/demos/' + id + '.json', import.meta.url), 'utf8'));
}
test('every visual example is a frozen, continuous Bend evaluation episode', async () => {
  for (const world of worlds) {
    const t = await demo(world.id);
    assert.equal(t.game, world.id);
    assert.equal(t.phase, 'test');
    assert.equal(t.initialModel, t.finalModel);
    assert.equal(t.frames.length, t.steps);
    assert.equal(
      t.frames.reduce((sum, f) => sum + f.reward, 0),
      t.score
    );
    for (const [i, f] of t.frames.entries()) {
      assert.deepEqual(observation(t, i), f.observation);
      assert.ok(f.accepted && f.legal.includes(f.action));
    }
    assert.deepEqual(observation(t, t.steps), t.frames.at(-1).nextObservation);
  }
});
test('symmetry-aware replay changes exactly one physical square per accepted move', async () => {
  const t = await demo('tic-tac-toe'),
    boards = boardStates(t);
  assert.deepEqual(boards[0], [0, 0]);
  t.frames.forEach((f, i) => {
    const [x, o] = boards[i + 1],
      side = Number(f.observation.second);
    const changed = boards[i][side] ^ boards[i + 1][side];
    assert.equal(x & o, 0);
    assert.equal(boards[i][1 - side], boards[i + 1][1 - side]);
    assert.ok(changed > 0 && (changed & (changed - 1)) === 0);
  });
  assert.deepEqual(boards.at(-1), [355, 156]);
  assert.deepEqual(
    boardStates({
      game: 'raw-board',
      symmetry: 0,
      frames: [
        { observation: { second: false }, action: 8, accepted: true },
        { observation: { second: true }, action: 1, accepted: true },
        { observation: { second: false }, action: 1, accepted: false }
      ]
    }),
    [
      [0, 0],
      [256, 0],
      [256, 2],
      [256, 2]
    ]
  );
});
test('GIF uses a shared palette, keeps the final frame and honors fast playback', async () => {
  const frames = timeline(240, 96);
  assert.equal(frames[0].step, 0);
  assert.equal(frames.at(-1).step, 240);
  assert.ok(frames.length < 241);
  assert.equal(
    frames.slice(0, -1).reduce((sum, f) => sum + f.delay, 0),
    250
  );
  assert.deepEqual(timeline(0, 2), [{ step: 0, delay: 80 }]);
  const px = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]),
    gif = new Gif(2, 1, px);
  gif.frame(px, 50);
  gif.frame(px.slice().reverse(), 80);
  const bytes = Buffer.from(await gif.finish().arrayBuffer());
  assert.equal(bytes.subarray(0, 6).toString(), 'GIF89a');
  assert.equal(bytes.at(-1), 59);
  assert.equal(bytes.readUInt16LE(6), 2);
  assert.equal(bytes.readUInt16LE(8), 1);
});
async function start(home, args = [], extra = {}) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--port', '0', ...args],
    {
      env: { ...process.env, BEND_STUDIO_HOME: home, ...extra },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  const exited = once(child, 'exit');
  const url = await new Promise((resolve, reject) => {
    let errors = '';
    child.stderr.on('data', (data) => {
      errors += data;
    });
    child.stdout.on('data', (d) => {
      const url = d.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) resolve(url);
    });
    child.on('error', reject);
    exited.then(() => reject(Error(errors || 'Server exited')));
  });
  return {
    url,
    async close() {
      child.kill();
      await exited;
    }
  };
}
const post = (url, input) =>
  fetch(url + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
test(
  'Studio trains, persists and replays a real run at multiple checkpoints',
  { timeout: 120000 },
  async (t) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'bend-studio-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const server = await start(home);
    let id;
    try {
      assert.equal((await (await fetch(server.url + '/api/catalog')).json()).length, 4);
      assert.equal((await post(server.url, null)).status, 400);
      assert.equal((await post(server.url, { world: 'cliff', algorithm: 'negamax' })).status, 400);
      const response = await post(server.url, {
        world: 'cliff',
        algorithm: 'q_learning',
        episodes: 12,
        seed: 89
      });
      const result = await response.json();
      assert.equal(response.status, 201, result.error);
      id = result.id;
      let run;
      for (let i = 0; i < 300; i++) {
        [run] = await (await fetch(server.url + '/api/runs')).json();
        if (run.status !== 'training') break;
        await delay(200);
      }
      assert.equal(run.status, 'ready', run.error);
      assert.deepEqual(run.checkpoints, [0, 3, 6, 12]);
      const url =
        server.url + '/api/runs/' + id + '/replay?game=cliff&arm=q_learning&rep=0&episode=0';
      assert.equal((await fetch(url + '&phase=test&point=3')).status, 400);
      for (const [phase, point] of [
        ['validation', 3],
        ['test', 12]
      ]) {
        const response = await fetch(url + '&phase=' + phase + '&point=' + point);
        const trace = await response.json();
        assert.equal(response.status, 200, trace.error);
        assert.equal(trace.checkpoint, point);
        assert.equal(trace.initialModel, trace.finalModel);
        assert.equal(trace.seed, 89 + (phase === 'test' ? 2200000000 : 1100000000));
      }
    } finally {
      await server.close();
    }
    const reopened = await start(home, ['--run', path.join(home, id, 'run')]);
    try {
      const jobs = await (await fetch(reopened.url + '/api/runs')).json();
      assert.ok(jobs.some((r) => r.id === id && r.status === 'ready'));
      assert.ok(jobs.some((r) => r.id.startsWith('import-') && r.arms.includes('q_learning')));
    } finally {
      await reopened.close();
    }
  }
);
test('demo playback and catalog work without a compiler', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'bend-demo-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const server = await start(home, [], { BEND: path.join(home, 'absent') });
  try {
    assert.equal((await fetch(server.url + '/demos/cliff.json')).status, 200);
    assert.equal(
      (await post(server.url, { world: 'cliff', algorithm: 'q_learning', episodes: 2, seed: 0 }))
        .status,
      503
    );
  } finally {
    await server.close();
  }
});
