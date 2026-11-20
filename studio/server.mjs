import {readRunNotes} from '../core/run_notes.mjs';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {openTrainingHost} from './training-client.mjs';
import {worlds} from './catalog.mjs';
import {readSummary} from './summary-reader.mjs';
import {unseal, checkedSnapshot} from '../core/experiment.mjs';
import {numberPreservingJson, symbol} from '../core/finite_world.mjs';
import {manifestPicker, readPlanSnapshot, savePlanSnapshot} from './manifests.mjs';
import {knownGridLayouts} from './grid-layouts.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url)),
  web = path.join(root, 'studio/web');
const picker = manifestPicker(root);
const layouts = knownGridLayouts(root);
const args = process.argv.slice(2);
let port = Number(process.env.PORT ?? 4173),
  base = path.resolve(process.env.BEND_STUDIO_HOME ?? path.join(root, '.bend-studio'));
const mounts = [];
const replayNodes = new Map([[process.versions.node, process.execPath]]);
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--port') port = Number(args[i + 1]);
  else if (args[i] === '--run' && args[i + 1]) mounts.push(path.resolve(args[i + 1]));
  else if (args[i] === '--replay-node' && args[i + 1]) {
    const executable = path.resolve(args[i + 1]);
    try {
      const version = execFileSync(executable, ['-p', 'process.versions.node'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
      }).trim();
      replayNodes.set(version, executable);
    } catch {
      console.error(
        'Cannot use --replay-node at ' +
          executable +
          '. Point it to an installed Node executable you can run.',
      );
      process.exit(1);
    }
  } else
    throw Error(
      'Usage: node studio/server.mjs [--port PORT] [--run TRUSTED_RUN_DIRECTORY] [--replay-node NODE_PATH]',
    );
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
fs.mkdirSync(base, {recursive: true});
const jobs = new Map(),
  mounted = new Map(),
  unavailableMounts = new Map();
const replayTimeout = Number(process.env.BEND_STUDIO_REPLAY_TIMEOUT_MS ?? 30000);
if (!Number.isInteger(replayTimeout) || replayTimeout < 1 || replayTimeout > 2147483647)
  throw Error('BEND_STUDIO_REPLAY_TIMEOUT_MS must be a positive 32-bit integer.');
const activeReplays = new Set();
let training;
let nextOrder = 1,
  restoring = true;
const QUEUE_LIMIT = 32;
let shuttingDown = false;
function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}
function integer(n, min, max, title) {
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('Invalid ' + title);
  return n;
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const iso = () => new Date().toISOString();
for (const [i, dir] of mounts.entries()) {
  try {
    const m = unseal(path.join(dir, 'run.json'));
    checkedSnapshot(dir, m);
    mounted.set('import-' + m.hash, dir);
  } catch {
    // Never register a damaged archive as executable or let it hide healthy runs.
    const id = 'unavailable-import-' + i;
    unavailableMounts.set(id, {
      id,
      name: path.basename(dir),
      status: 'unavailable',
      error: 'Attached archive failed validation.',
    });
  }
}
function jobPath(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail('Run not found', 404);
  return path.join(base, id);
}
function save(job) {
  const p = path.join(jobPath(job.id), 'studio.json');
  fs.writeFileSync(p + '.tmp', JSON.stringify(job));
  fs.renameSync(p + '.tmp', p);
  jobs.set(job.id, job);
}
// Recovery and new training begin only after the previous host has released this home.
const trainingMarker = path.join(base, 'training-active.json');
const trainingHost = await openTrainingHost(fs.realpathSync(base), () => {
  console.error('Training host disconnected unexpectedly. Restart Studio to recover this home.');
  process.exit(1);
});
for (const entry of fs.readdirSync(base, {withFileTypes: true})) {
  if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
    const p = path.join(base, entry.name, 'studio.json');
    if (!fs.existsSync(p)) continue;
    try {
      const job = read(p);
      if (
        job?.id !== entry.name ||
        typeof job.name !== 'string' ||
        !['training', 'queued', 'ready', 'failed', 'interrupted', 'cancelled'].includes(job.status)
      )
        throw Error('Invalid Studio metadata.');
      if (job.status === 'queued') {
        if (!Number.isSafeInteger(job.queueOrder) || job.queueOrder < 1)
          throw Error('Invalid queue position.');
        if (job.manifest) readPlanSnapshot(jobPath(job.id), job.manifestHash);
        else checkSpec(job);
      }
      if (Number.isSafeInteger(job.queueOrder) && job.queueOrder > 0)
        nextOrder = Math.max(nextOrder, job.queueOrder + 1);
      if (job.status === 'training') {
        if (!job.supervised && !fs.existsSync(trainingMarker)) {
          // Legacy runners have no IPC owner. Their identities cannot be recovered safely.
          fs.writeFileSync(trainingMarker, JSON.stringify({legacyRun: job.id}) + '\n', {
            flag: 'wx',
          });
        }
        job.status = 'interrupted';
        job.error = 'Studio stopped before training finished.';
        save(job);
      } else jobs.set(job.id, job);
    } catch (err) {
      jobs.set(entry.name, {
        id: entry.name,
        name: entry.name,
        status: 'unavailable',
        error: err.message,
      });
    }
  }
}
// The live map is insertion ordered; UUID directory enumeration is not.
// Restore that ordering once so a restart doesn't shuffle the run list.
{
  const order = (j) => (Number.isSafeInteger(j.queueOrder) && j.queueOrder > 0 ? j.queueOrder : 0);
  const created = (j) => (typeof j.created === 'string' ? j.created : '');
  const recovered = [...jobs.values()].sort(
    (a, b) =>
      order(a) - order(b) || created(a).localeCompare(created(b)) || a.id.localeCompare(b.id),
  );
  jobs.clear();
  for (const job of recovered) jobs.set(job.id, job);
}
function directory(id) {
  if (unavailableMounts.has(id)) fail('Attached archive is unavailable.', 409);
  if (mounted.has(id)) return mounted.get(id);
  if (!jobs.has(id)) fail('Run not found', 404);
  return path.join(jobPath(id), 'run');
}
function describe(id) {
  if (unavailableMounts.has(id)) return unavailableMounts.get(id);
  const j = jobs.get(id);
  if (j?.status === 'queued')
    return {...j, position: pendingJobs().findIndex((q) => q.id === id) + 1};
  if (j && j.status !== 'ready') return j;
  const dir = directory(id),
    manifest = unseal(path.join(dir, 'run.json')),
    p = manifest.body.plan;
  return {
    ...(j ?? {id, status: 'ready', attached: true, name: p.name, created: null}),
    ...readRunNotes(dir),
    nodeVersion: manifest.body.toolchain.node,
    games: p.games.map((g) => ({id: g.id, symmetry: g.parameters?.symmetry})),
    arms: p.arms.map((a) => a.id),
    checkpoints: p.checkpoints,
    replicates: p.replicates,
    validation: p.validationEpisodes,
    test: p.testEpisodes,
    budgetUnit: p.budgetUnit ?? 'episodes',
  };
}
function browseManifest(file) {
  try {
    return picker.load(file);
  } catch (err) {
    fail(err.message);
  }
}
function checkSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected a JSON object.');
  const w = worlds.find((x) => x.id === input.world),
    a = w?.algorithms.find((x) => x.id === input.algorithm);
  if (!w || !a) fail('Choose an environment and a compatible agent.');
  const n = integer(input.episodes, 1, 32768, 'training budget'),
    seed = integer(input.seed, 0, 1000000000, 'seed');
  return {w, a, n, seed};
}
let versionCheck;
function checkVersion() {
  versionCheck ??= probeVersion().catch((err) => {
    versionCheck = undefined;
    throw err;
  });
  return versionCheck;
}
async function probeVersion() {
  let version;
  try {
    version = await trainingHost.request('version');
  } catch {
    fail(
      'Bend 2.0.40 is needed for training. Install it on PATH or start Studio with BEND=/path/to/bend.',
      503,
    );
  }
  if (version.trim() !== 'bend 2.0.40')
    fail(
      'Training requires Bend 2.0.40. The configured compiler reports ' + version.trim() + '.',
      503,
    );
}
function pendingJobs() {
  return [...jobs.values()]
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.queueOrder - b.queueOrder || a.id.localeCompare(b.id));
}
function makePlan({w, a, n, seed}) {
  const {id: method, name, ...params} = a;
  const arena = w.id === 'tic-tac-toe';
  const arm = arena
    ? {
        id: method,
        method: 'custom',
        domain: 'arena',
        agentFile: path.join(root, 'agents/self_play/agent.bend'),
        parameters: {...params, alpha: 0.25, gamma: 1, epsilon: 0.25},
      }
    : {id: method, method, ...params};
  const game = arena
    ? {
        id: w.id,
        domain: 'arena',
        worldFile: path.join(root, 'worlds/tictactoe.bend'),
        parameters: {symmetry: 1},
        limit: w.limit,
      }
    : {id: w.id, limit: w.limit};
  const config = {
    schema: 1,
    name: 'studio-' + w.id,
    games: [game],
    arms: [arm],
    replicates: 1,
    checkpoints: [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), n])],
    validationEpisodes: 8,
    testEpisodes: 8,
    seeds: {train: seed, validation: seed + 1100000000, test: seed + 2200000000, stride: 50000},
  };
  return config;
}
async function create(input) {
  if (!training && fs.existsSync(trainingMarker))
    fail(
      'Previous training needs review. Verify its processes have stopped, then remove training-active.json from the Studio home.',
      409,
    );
  const manifest =
    input && Object.hasOwn(input, 'manifest') ? browseManifest(input.manifest) : null;
  const preset = manifest ? null : checkSpec(input);
  await checkVersion();
  if (shuttingDown) fail('Studio is stopping.', 503);
  if (pendingJobs().length >= QUEUE_LIMIT) fail('Training queue is full.', 429);
  if (!Number.isSafeInteger(nextOrder)) fail('Queue order exhausted.', 503);
  const id = randomUUID(),
    dir = jobPath(id);
  fs.mkdirSync(dir);

  const job = {
    id,
    ...(manifest
      ? {
          name: manifest.info.name,
          manifest: manifest.info.file,
          hooks: manifest.info.hooks,
          manifestHash: savePlanSnapshot(dir, manifest.snapshot),
        }
      : {
          name: preset.w.name + ' · ' + preset.a.name,
          world: preset.w.id,
          algorithm: preset.a.id,
          episodes: preset.n,
          seed: preset.seed,
        }),
    created: iso(),
    status: 'queued',
    queueOrder: nextOrder++,
    supervised: true,
  };
  save(job);
  pump();
  return describe(id);
}
function pump() {
  if (restoring || shuttingDown || training || fs.existsSync(trainingMarker)) return;
  const queued = pendingJobs()[0];
  if (!queued) return;
  const id = queued.id,
    dir = jobPath(id),
    job = {...queued, status: 'training', started: iso()};
  try {
    // Reconstruct from the catalog or the checked self-contained plan snapshot.
    const source = job.manifest
      ? readPlanSnapshot(dir, job.manifestHash).source
      : makePlan(checkSpec(job));
    const tmp = path.join(dir, 'plan-' + randomUUID() + '.tmp');
    fs.writeFileSync(tmp, numberPreservingJson(source, 2), {flag: 'wx'});
    fs.renameSync(tmp, path.join(dir, 'plan.json'));
    save(job);
  } catch (err) {
    jobs.set(id, {...job, status: 'unavailable', error: err.message});
    queueMicrotask(pump);
    return;
  }
  const task = {id};
  training = task;
  task.done = trainingHost
    .request('run', dir)
    .catch((err) => ({status: 'failed', error: err.message}))
    .then((result) => {
      try {
        save({...job, ...result, finished: iso()});
      } catch (err) {
        jobs.set(id, {...job, status: 'unavailable', error: err.message});
      }
      training = undefined;
      pump();
      return jobs.get(id);
    });
}
async function stopTraining(task, command) {
  await trainingHost.request(command, jobPath(task.id));
  return task.done;
}
async function replay(id, input, res) {
  const info = describe(id);
  if (info.status !== 'ready') fail('This run is not ready.', 409);
  const {game, arm, phase} = input,
    point = Number(input.point),
    rep = Number(input.rep),
    episode = Number(input.episode);
  if (
    !info.games.some((g) => g.id === game) ||
    !info.arms.includes(arm) ||
    !info.checkpoints.includes(point)
  )
    fail('Unknown game, agent or checkpoint.');
  if (
    !['validation', 'test'].includes(phase) ||
    (phase === 'test' && point !== info.checkpoints.at(-1))
  )
    fail('Test episodes use the final checkpoint.');
  integer(rep, 0, info.replicates - 1, 'replicate');
  integer(episode, 0, info[phase] - 1, 'episode');
  const dir = directory(id);
  if (activeReplays.size >= 2) fail('Studio is running two replays. Try again shortly.', 429);
  // Only the local owner can attach existing executable runs, at server startup.
  const runtime = replayNodes.get(info.nodeVersion);
  if (!runtime)
    fail(
      'Replay requires Node ' +
        info.nodeVersion +
        '. Studio is running Node ' +
        process.versions.node +
        '. Restart Studio with --replay-node pointing to the recorded Node executable.',
      409,
    );
  const pending = exec(
    runtime,
    [
      path.join(dir, 'code/experiment.mjs'),
      'replay',
      dir,
      game,
      arm,
      String(rep),
      String(point),
      phase,
      String(episode),
    ],
    {maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL'},
  );
  const child = pending.child;
  activeReplays.add(child);
  const stop = () => child.kill('SIGKILL');
  res.once('close', stop);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, replayTimeout);
  let trace;
  try {
    trace = JSON.parse((await pending).stdout);
  } catch (err) {
    if (timedOut) fail('Replay exceeded its time limit.', 504);
    if (err.stderr?.trim() === 'missing replay checkpoint')
      fail(
        'Checkpoint ' +
          point +
          ' is unavailable for this trial. Choose an earlier saved checkpoint or verify the study.',
        409,
      );
    throw err;
  } finally {
    clearTimeout(timer);
    res.off('close', stop);
    activeReplays.delete(child);
  }
  const plan = unseal(path.join(dir, 'run.json')).body.plan;
  const definition = plan.games.find((g) => g.id === game)?.definition;
  const key = definition && symbol(definition),
    job = jobs.get(id);
  let gridLayout = key && layouts.get(key);
  if (key && !gridLayout && job?.manifest) {
    try {
      gridLayout = readPlanSnapshot(jobPath(id), job.manifestHash).layouts[key];
    } catch {
      /* Optional display metadata must not block verified replay. */
    }
  }
  // These renderers decode base observations, not a history encoding.
  if (
    ['courier', 'apex-kart'].includes(gridLayout?.renderer) &&
    plan.arms.find((a) => a.id === arm)?.observation === 'previous'
  )
    gridLayout = undefined;
  return {
    ...trace,
    gridLayout,
    symmetry: info.games.find((g) => g.id === game).symmetry,
    trainingBudget: point,
    budgetUnit: info.budgetUnit,
  };
}
async function body(req) {
  let text = '';
  for await (const c of req) {
    text += c;
    if (text.length > 4096) fail('Request too large', 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail('Invalid JSON');
  }
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = http.createServer(async (req, res) => {
  try {
    const permitted = ['localhost', '127.0.0.1', '[::1]'].map(
      (h) => h + ':' + server.address().port,
    );
    if (!permitted.includes(req.headers.host)) fail('Use the local Studio address.', 403);
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)
      fail('Origin rejected', 403);
    const u = new URL(req.url, 'http://localhost');
    const json = (v, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(v));
    };
    if (req.method === 'GET' && u.pathname === '/api/catalog') return json(worlds);
    if (req.method === 'GET' && u.pathname === '/api/manifests') return json(picker.list());
    if (req.method === 'GET' && u.pathname === '/api/manifest')
      return json(browseManifest(u.searchParams.get('file')).info);
    if (req.method === 'GET' && u.pathname === '/api/runs')
      return json(
        [...jobs.keys(), ...mounted.keys(), ...unavailableMounts.keys()]
          .map((id) => {
            try {
              return describe(id);
            } catch (err) {
              return {
                ...jobs.get(id),
                id,
                name: jobs.get(id)?.name ?? id,
                status: 'unavailable',
                error: err.message,
              };
            }
          })
          .reverse(),
      );
    if (req.method === 'POST' && u.pathname === '/api/runs')
      return json(await create(await body(req)), 201);
    const cancel = /^\/api\/runs\/([a-z0-9-]+)\/cancel$/.exec(u.pathname);
    if (req.method === 'POST' && cancel) {
      const queued = jobs.get(cancel[1]);
      if (queued?.status === 'queued') {
        const cancelled = {
          ...queued,
          status: 'cancelled',
          error: 'Cancelled before training.',
          finished: iso(),
        };
        save(cancelled);
        return json(cancelled);
      }
      if (!training || training.id !== cancel[1]) fail('This run is not training.', 409);
      return json(await stopTraining(training, 'cancel'));
    }
    const summary = /^\/api\/runs\/([a-z0-9-]+)\/summary$/.exec(u.pathname);
    if (req.method === 'GET' && summary) {
      const id = summary[1],
        dir = directory(id);
      if (jobs.has(id) && jobs.get(id).status !== 'ready') fail('This run is not ready.', 409);
      return json(await readSummary(dir, res));
    }
    const m = /^\/api\/runs\/([a-z0-9-]+)\/replay$/.exec(u.pathname);
    if (req.method === 'GET' && m)
      return json(await replay(m[1], Object.fromEntries(u.searchParams), res));
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('Method not allowed', 405);
    let pathname;
    try {
      pathname = decodeURIComponent(u.pathname);
    } catch {
      fail('Invalid URL encoding.', 400);
    }
    const f = path.resolve(web, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!f.startsWith(web + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile())
      fail('File not found', 404);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(f)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(f);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    if (res.destroyed) return;
    res.writeHead(e.status ?? 500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: e.message}));
  }
});
// A service manager may signal only the Studio process during shutdown.
async function shutdown(code) {
  shuttingDown = true;
  server.close();
  server.closeAllConnections();
  if (training) await stopTraining(training, 'interrupt');
  process.exit(code);
}
process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));
process.on('exit', () => {
  trainingHost.close();
  for (const child of activeReplays) child.kill('SIGKILL');
});
server.on('error', (e) => {
  console.error(e.message);
  trainingHost.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', async () => {
  console.log('Bend Studio is ready at http://127.0.0.1:' + server.address().port);
  if (pendingJobs().length && !fs.existsSync(trainingMarker)) {
    try {
      await checkVersion();
    } catch (err) {
      // No run has started. Preserve queued jobs; a later successful submit
      // or a restart with a usable compiler can resume FIFO processing.
      console.error('Recovered jobs remain queued:', err.message);
      restoring = false;
      return;
    }
  }
  restoring = false;
  pump();
});
