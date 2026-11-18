import { compilerTest } from '../bend_test_support.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { worlds } from './catalog.mjs';
import { boardStates, cumulativeReturns, observation } from './web/scene.js';
import { timeline } from './web/exporter.js';
import { Gif } from './web/gif.js';
import { seal } from '../experiment.mjs';
import { digest } from '../experiment_config.mjs';

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
test('a rejected final move preserves the accumulated Bend return', () => {
  const frames = [{ accepted: true, reward: 0.1 }, { accepted: true, reward: 0.2 }, { accepted: false }];
  const [, first, second, final] = cumulativeReturns(frames);
  assert.equal(first, Math.fround(0.1));
  assert.equal(second, Math.fround(first + 0.2));
  assert.equal(final, second);
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
  const closed = once(child, 'close');
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
    url, exited,
    async close(signal) {
      child.kill(signal);
      await exited;
      // For ordinary teardown also wait for inherited stderr to close. Crash
      // tests restart on server exit, while the supervisor may still be draining.
      if (signal !== 'SIGKILL') await closed;
    }
  };
}
const post = (url, input) =>
  fetch(url + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

// A small, trusted archive lets the HTTP tests control exactly when a runner
// starts and finishes without involving compiler speed or model size.
async function mountedReplay(t, timeout, nodeVersion = process.versions.node) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-replay-'));
  const dir = path.join(home, 'fixture');
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'code'), { recursive: true });
  const runner = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { setTimeout } from 'node:timers/promises';
    const episode = process.argv.at(-1);
    fs.writeFileSync(path.join(process.argv[3], episode + '.pid'), String(process.pid));
    if (episode === '0' || episode === '1') await setTimeout(120000);
    if (episode === '3') process.exit(1);
    console.log(JSON.stringify({episode}));
  `;
  await writeFile(path.join(dir, 'code/experiment.mjs'), runner);
  await writeFile(path.join(dir, 'code/backend.mjs'), '');
  const manifest = seal({
    plan: { name: 'fixture', games: [{ id: 'cliff' }], arms: [{ id: 'q' }], checkpoints: [0],
      replicates: 1, validationEpisodes: 0, testEpisodes: 4 },
    toolchain: { node: nodeVersion, sources: { 'experiment.mjs': digest(runner) }, backend: digest('') }
  });
  await writeFile(path.join(dir, 'run.json'), manifest);
  const server = await start(home, ['--run', dir], { BEND_STUDIO_REPLAY_TIMEOUT_MS: String(timeout) });
  const url = server.url + '/api/runs/import-' + JSON.parse(manifest).hash +
    '/replay?game=cliff&arm=q&rep=0&point=0&phase=test&episode=';
  return { server, dir, replay: (episode, options) => fetch(url + episode, options) };
}
async function waitForRunner(dir, episode) {
  for (let i = 0; i < 200; i++) {
    try {
      const pid = Number(await readFile(path.join(dir, episode + '.pid'), 'utf8'));
      if (pid > 0) return pid;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await delay(25);
  }
  assert.fail('Replay runner did not start.');
}
function hasExited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
    return true;
  }
}
test('mismatched archived Node version gives an actionable conflict', async (t) => {
  const { server, replay } = await mountedReplay(t, 30000, '24.0.0-test');
  try {
    const response = await replay(2);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /24\.0\.0-test.*--replay-node/);
  } finally {
    await server.close();
  }
});
test('one damaged run leaves healthy runs and the catalog accessible', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-list-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const ids = ['a', 'b', 'c'].map(c => c.repeat(36));
  for (const [i, id] of ids.entries()) {
    await mkdir(path.join(home, id));
    const job = { id, name: 'run ' + i, status: i === 1 ? 'ready' : 'interrupted' };
    await writeFile(path.join(home, id, 'studio.json'), i === 0 ? '{' : JSON.stringify(job));
  }
  const server = await start(home);
  try {
    const response = await fetch(server.url + '/api/runs');
    assert.equal(response.status, 200);
    const list = await response.json();
    assert.deepEqual(ids.map(id => list.find(run => run.id === id)?.status),
      ['unavailable', 'unavailable', 'interrupted']);
    assert.equal(await readFile(path.join(home, ids[0], 'studio.json'), 'utf8'), '{');
    assert.equal((await fetch(server.url + '/api/catalog')).status, 200);
    assert.equal((await fetch(server.url + '/%E0%A4%A')).status, 400);
  } finally {
    await server.close();
  }
});
test('replay deadline and runner failure release capacity', { timeout: 15000 }, async (t) => {
  const { server, dir, replay } = await mountedReplay(t, 1000);
  try {
    const pending = replay(0);
    const pid = await waitForRunner(dir, 0);
    const result = await pending;
    assert.equal(result.status, 504);
    assert.match((await result.json()).error, /time limit/);
    assert.ok(hasExited(pid));
    assert.equal((await replay(3)).status, 500);
    const success = await replay(2);
    assert.equal(success.status, 200);
    assert.equal((await success.json()).episode, '2');
  } finally {
    await server.close();
  }
});
async function controlledCompiler(home, cpuBound = false) {
  const shim = path.join(home, 'compiler.mjs'), marker = path.join(home, 'compiler.pid');
  await writeFile(shim, `
    import path from 'node:path';
    import fs from 'node:fs';
    import { isMainThread } from 'node:worker_threads';
    if (isMainThread && path.basename(process.argv[1] ?? '') === 'training-host.mjs' && process.env.TEST_HOST_EXIT) {
      setInterval(() => {
        if (fs.existsSync(process.env.TEST_HOST_EXIT)) process.exit(77);
      }, 20).unref();
    }
    if (path.basename(process.argv[1] ?? '') === 'version') {
      console.log('bend 2.0.40');
      process.exit(0);
    }
    if (process.argv[1]?.endsWith('.bend')) {
      if (process.env.TEST_CPU_BOUND === 'true') {
        // A backend stuck in synchronous JS cannot service its own IPC callbacks.
        fs.writeFileSync(process.argv.at(-1), [
          "import fs from 'node:fs';",
          "fs.writeFileSync(process.env.TEST_COMPILER_PID, String(process.pid));",
          "const deadline = Date.now() + 20000;",
          "while (Date.now() < deadline) {}",
          "throw Error('CPU fixture expired');"
        ].join('\\n'));
        process.exit(0);
      }
      fs.writeFileSync(process.env.TEST_COMPILER_PID, String(process.pid));
      setTimeout(() => process.exit(1), Number(process.env.TEST_COMPILER_TTL ?? 20000));
      await new Promise(() => {});
    }
  `);
  return { BEND: process.execPath, TEST_COMPILER_PID: marker, TEST_CPU_BOUND: String(cpuBound),
    NODE_OPTIONS: '--import=' + pathToFileURL(shim).href };
}
const tinyRun = { world: 'cliff', algorithm: 'q_learning', episodes: 2, seed: 0 };
for (const cpuBound of [false, true]) {
  test('forced Studio exit during ' + (cpuBound ? 'CPU training' : 'compilation') +
    ' permits a clean restart', { timeout: 30000 }, async (t) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'studio-crash-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const options = await controlledCompiler(home, cpuBound);
    const first = await start(home, [], options);
    let job, oldPid;
    try {
      const response = await post(first.url, tinyRun);
      assert.equal(response.status, 201);
      job = await response.json();
      oldPid = await waitForRunner(home, 'compiler');
      assert.equal((await post(first.url, tinyRun)).status, 409);
    } finally {
      await first.close('SIGKILL');
    }

    // Restart immediately. The disk record alone cannot authorize a new run.
    const second = await start(home, [], options);
    try {
      const [recovered] = await (await fetch(second.url + '/api/runs')).json();
      assert.equal(recovered.id, job.id);
      assert.equal(recovered.status, 'interrupted');
      // The CPU fixture shares its supervisor's PID, which can exit just after unlocking.
      for (let i = 0; i < 100 && !hasExited(oldPid); i++) await delay(25);
      assert.ok(hasExited(oldPid), 'previous training process must have exited');
      assert.ok(!(await readdir(path.join(home, job.id))).some(name => name.startsWith('tmp-')));
      await rm(options.TEST_COMPILER_PID);
      const response = await post(second.url, tinyRun);
      assert.equal(response.status, 201);
      const next = await response.json();
      await waitForRunner(home, 'compiler');
      const cancel = await fetch(second.url + '/api/runs/' + next.id + '/cancel', { method: 'POST' });
      assert.equal((await cancel.json()).status, 'cancelled');
    } finally {
      await second.close();
    }
  });
}
test('loss of the supervisor keeps new training blocked until ownership is resolved', { timeout: 15000 }, async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-host-loss-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const options = await controlledCompiler(home);
  const trigger = path.join(home, 'exit-host');
  const first = await start(home, [], { ...options, TEST_HOST_EXIT: trigger, TEST_COMPILER_TTL: '3000' });
  let compiler;
  try {
    assert.equal((await post(first.url, tinyRun)).status, 201);
    compiler = await waitForRunner(home, 'compiler');
    await writeFile(trigger, '');
    assert.equal((await first.exited)[0], 1);
  } finally {
    await first.close();
  }
  const second = await start(home, [], options);
  try {
    assert.equal((await post(second.url, tinyRun)).status, 409);
    assert.equal((await (await fetch(second.url + '/api/runs')).json())[0].status, 'interrupted');
    for (let i = 0; i < 200 && !hasExited(compiler); i++) await delay(25);
    assert.ok(hasExited(compiler), 'bounded fixture exits on its own');
    assert.equal((await post(second.url, tinyRun)).status, 409);
    await rm(path.join(home, 'training-active.json'));
    const response = await post(second.url, tinyRun);
    assert.equal(response.status, 201);
    const { id } = await response.json();
    await fetch(second.url + '/api/runs/' + id + '/cancel', { method: 'POST' });
  } finally {
    await second.close();
  }
});
test('a second Studio cannot recover a live home or act on a saved PID', { timeout: 15000 }, async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-owner-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const id = 'd'.repeat(36);
  await mkdir(path.join(home, id));
  // A stale or unrelated PID in a legacy record is data only.
  await writeFile(path.join(home, id, 'studio.json'), JSON.stringify({ id, name: 'old',
    status: 'training', pid: process.pid, runnerPid: process.pid }));
  const owner = await start(home);
  try {
    await assert.rejects(start(home), /Studio home is in use/);
    const [job] = await (await fetch(owner.url + '/api/runs')).json();
    assert.equal(job.status, 'interrupted');
    const blocked = await post(owner.url, tinyRun);
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /training-active.json/);
    assert.deepEqual(JSON.parse(await readFile(path.join(home, 'training-active.json'), 'utf8')), { legacyRun: id });
  } finally {
    await owner.close();
  }
});
test('training cancellation stops both runner and compiler and persists the result', { timeout: 30000 }, async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-cancel-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const options = await controlledCompiler(home);
  const marker = options.TEST_COMPILER_PID;
  const server = await start(home, [], options);
  async function begin() {
    const response = await post(server.url, { world: 'cliff', algorithm: 'q_learning', episodes: 2, seed: 0 });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    return { id, pid: await waitForRunner(home, 'compiler') };
  }
  async function checkStopped(job, status) {
    assert.equal(JSON.parse(await readFile(path.join(home, job.id, 'studio.json'), 'utf8')).status, status);
    for (let i = 0; i < 200 && !hasExited(job.pid); i++) await delay(25);
    assert.ok(hasExited(job.pid), 'compiler must stop with its runner');
  }
  let interrupted;
  try {
    const job = await begin();
    const cancel = () => fetch(server.url + '/api/runs/' + job.id + '/cancel', { method: 'POST' });
    const response = await cancel();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'cancelled');
    await checkStopped(job, 'cancelled');
    assert.equal((await cancel()).status, 409);
    if (process.platform !== 'win32') {
      await rm(marker);
      interrupted = await begin();
    }
  } finally {
    await server.close();
  }
  if (interrupted) await checkStopped(interrupted, 'interrupted');
});
test('replay capacity, client disconnect and shutdown stop the right runners', { timeout: 15000 }, async (t) => {
  const { server, dir, replay } = await mountedReplay(t, 60000);
  const client = new AbortController();
  // Consume rejections immediately. The second connection closes on shutdown.
  const first = assert.rejects(replay(0, { signal: client.signal }), { name: 'AbortError' });
  const otherClient = new AbortController();
  const second = assert.rejects(replay(1, { signal: otherClient.signal }));
  let remaining;
  try {
    const cancelled = await waitForRunner(dir, 0);
    remaining = await waitForRunner(dir, 1);
    assert.equal((await replay(2)).status, 429);
    client.abort();
    await first;
    for (let i = 0; i < 200 && !hasExited(cancelled); i++) await delay(25);
    assert.ok(hasExited(cancelled));
    assert.equal((await replay(2)).status, 200);
    assert.equal(hasExited(remaining), false);
  } finally {
    client.abort();
    // Windows TerminateProcess bypasses Node signal handlers.
    if (process.platform === 'win32') {
      otherClient.abort();
      for (let i = 0; remaining && i < 200 && !hasExited(remaining); i++) await delay(25);
    }
    await server.close();
    await second;
  }
  for (let i = 0; i < 200 && !hasExited(remaining); i++) await delay(25);
  assert.ok(hasExited(remaining));
});
test(
  'Studio trains, persists and replays a real run at multiple checkpoints',
  { ...compilerTest, timeout: 120000 },
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
      const annotation={notes:'Pilot baseline',tags:['pilot']};
      await writeFile(path.join(home,id,'run','notes.json'),JSON.stringify(annotation));
      const annotated=await(await fetch(server.url+'/api/runs')).json();
      assert.deepEqual(annotated.find(r=>r.id===id).annotations,annotation);
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
