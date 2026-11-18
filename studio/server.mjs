import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { worlds } from './catalog.mjs';
import { unseal, checkedSnapshot } from '../experiment.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url)),
  web = path.join(root, 'studio/web');
const args = process.argv.slice(2);
let port = Number(process.env.PORT ?? 4173),
  base = path.resolve(process.env.BEND_STUDIO_HOME ?? path.join(root, '.bend-studio'));
const mounts = [];
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--port') port = Number(args[i + 1]);
  else if (args[i] === '--run' && args[i + 1]) mounts.push(path.resolve(args[i + 1]));
  else throw Error('Usage: node studio/server.mjs [--port PORT] [--run TRUSTED_RUN_DIRECTORY]');
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
fs.mkdirSync(base, { recursive: true });
const jobs = new Map(),
  mounted = new Map();
const bend = process.env.BEND || 'bend';
const replayTimeout = Number(process.env.BEND_STUDIO_REPLAY_TIMEOUT_MS ?? 30000);
if (!Number.isInteger(replayTimeout) || replayTimeout < 1 || replayTimeout > 2147483647)
  throw Error('BEND_STUDIO_REPLAY_TIMEOUT_MS must be a positive 32-bit integer.');
const activeReplays = new Set();
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function integer(n, min, max, title) {
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('Invalid ' + title);
  return n;
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const iso = () => new Date().toISOString();
for (const dir of mounts) {
  const m = unseal(path.join(dir, 'run.json'));
  checkedSnapshot(dir, m);
  mounted.set('import-' + m.hash, dir);
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
for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
  if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
    const p = path.join(base, entry.name, 'studio.json');
    if (!fs.existsSync(p)) continue;
    const job = read(p);
    if (job.id !== entry.name) continue;
    if (job.status === 'training') {
      job.status = 'interrupted';
      job.error = 'Studio stopped before training finished.';
      save(job);
    } else jobs.set(job.id, job);
  }
}
function directory(id) {
  if (mounted.has(id)) return mounted.get(id);
  if (!jobs.has(id)) fail('Run not found', 404);
  return path.join(jobPath(id), 'run');
}
function describe(id) {
  const j = jobs.get(id);
  if (j && j.status !== 'ready') return j;
  const dir = directory(id),
    manifest = unseal(path.join(dir, 'run.json')),
    p = manifest.body.plan;
  return {
    ...(j ?? { id, status: 'ready', name: p.name, created: null }),
    games: p.games.map((g) => ({ id: g.id, symmetry: g.parameters?.symmetry })),
    arms: p.arms.map((a) => a.id),
    checkpoints: p.checkpoints,
    replicates: p.replicates,
    validation: p.validationEpisodes,
    test: p.testEpisodes,
    budgetUnit: p.budgetUnit ?? 'episodes'
  };
}
async function create(input) {
  if (jobs.size && [...jobs.values()].some((j) => j.status === 'training'))
    fail('A training run is already in progress.', 409);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected a JSON object.');
  const w = worlds.find((x) => x.id === input.world),
    a = w?.algorithms.find((x) => x.id === input.algorithm);
  if (!w || !a) fail('Choose an environment and a compatible agent.');
  const n = integer(input.episodes, 1, 32768, 'training budget'),
    seed = integer(input.seed, 0, 1000000000, 'seed');
  let version;
  try {
    ({ stdout: version } = await exec(bend, ['version'], { timeout: 5000 }));
  } catch {
    fail(
      'Bend 2.0.40 is needed for training. Install it on PATH or start Studio with BEND=/path/to/bend.',
      503
    );
  }
  if (version.trim() !== 'bend 2.0.40')
    fail(
      'Training requires Bend 2.0.40. The configured compiler reports ' + version.trim() + '.',
      503
    );
  if ([...jobs.values()].some((j) => j.status === 'training'))
    fail('A training run is already in progress.', 409);
  const id = randomUUID(),
    dir = jobPath(id);
  fs.mkdirSync(dir);
  const { id: method, name, ...params } = a;
  const arena = w.id === 'tic-tac-toe';
  const arm = arena
    ? {
        id: method,
        method: 'custom',
        domain: 'arena',
        agentFile: path.join(root, 'agents/self_play.bend'),
        parameters: { ...params, alpha: 0.25, gamma: 1, epsilon: 0.25 }
      }
    : { id: method, method, ...params };
  const game = arena
    ? {
        id: w.id,
        domain: 'arena',
        worldFile: path.join(root, 'worlds/tictactoe.bend'),
        parameters: { symmetry: 1 },
        limit: w.limit
      }
    : { id: w.id, limit: w.limit };
  const config = {
    schema: 1,
    name: 'studio-' + w.id,
    games: [game],
    arms: [arm],
    replicates: 1,
    checkpoints: [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), n])],
    validationEpisodes: 8,
    testEpisodes: 8,
    seeds: { train: seed, validation: seed + 1100000000, test: seed + 2200000000, stride: 50000 }
  };
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(config, null, 2));
  const job = {
    id,
    name: w.name + ' · ' + name,
    world: w.id,
    algorithm: method,
    episodes: n,
    seed,
    created: iso(),
    status: 'training'
  };
  save(job);
  exec(
    process.execPath,
    [
      path.join(root, 'experiment.mjs'),
      'run',
      path.join(dir, 'plan.json'),
      path.join(dir, 'run'),
      '--bend',
      bend
    ],
    { maxBuffer: 2 ** 20 }
  ).then(
    () => {
      save({ ...job, status: 'ready' });
    },
    (err) => {
      save({ ...job, status: 'failed', error: (err.stderr || err.message).trim().slice(-700) });
    }
  );
  return job;
}
async function replay(id, input, res) {
  const info = describe(id);
  if (info.status !== 'ready') fail('This run is not ready.', 409);
  const { game, arm, phase } = input,
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
  const pending = exec(
    process.execPath,
    [
      path.join(dir, 'code/experiment.mjs'),
      'replay',
      dir,
      game,
      arm,
      String(rep),
      String(point),
      phase,
      String(episode)
    ],
    { maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL' }
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
    throw err;
  } finally {
    clearTimeout(timer);
    res.off('close', stop);
    activeReplays.delete(child);
  }
  return {
    ...trace,
    symmetry: info.games.find((g) => g.id === game).symmetry,
    trainingBudget: point,
    budgetUnit: info.budgetUnit
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
  '.ico': 'image/x-icon'
};
const server = http.createServer(async (req, res) => {
  try {
    const permitted = ['localhost', '127.0.0.1', '[::1]'].map((h) => h + ':' + server.address().port);
    if (!permitted.includes(req.headers.host)) fail('Use the local Studio address.', 403);
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)
      fail('Origin rejected', 403);
    const u = new URL(req.url, 'http://localhost');
    const json = (v, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(JSON.stringify(v));
    };
    if (req.method === 'GET' && u.pathname === '/api/catalog') return json(worlds);
    if (req.method === 'GET' && u.pathname === '/api/runs')
      return json([...jobs.keys(), ...mounted.keys()].map(describe).reverse());
    if (req.method === 'POST' && u.pathname === '/api/runs')
      return json(await create(await body(req)), 201);
    const m = /^\/api\/runs\/([a-z0-9-]+)\/replay$/.exec(u.pathname);
    if (req.method === 'GET' && m)
      return json(await replay(m[1], Object.fromEntries(u.searchParams), res));
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('Method not allowed', 405);
    const f = path.resolve(
      web,
      '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)
    );
    if (!f.startsWith(web + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile())
      fail('File not found', 404);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(f)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(f);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    if (res.destroyed) return;
    res.writeHead(e.status ?? 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});
// A service manager may signal only the Studio process during shutdown.
process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));
process.on('exit', () => {
  for (const child of activeReplays) child.kill('SIGKILL');
});
server.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log('Bend Studio is ready at http://127.0.0.1:' + server.address().port)
);
