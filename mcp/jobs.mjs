import {numberPreservingJson} from '../finite_world.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {killGroup, launch} from './context.mjs';
import {choice, str, uint, tool, planInput} from './schema.mjs';
import {unseal} from '../experiment.mjs';
const history = new Map();
let active;
const shard = {type: 'string', pattern: '^[0-9]{1,9}/[1-9][0-9]{0,8}$'};
function options(a) {
  if (a.shard) {
    const [i, n] = a.shard.split('/').map(Number);
    if (i >= n) throw Error('shard index must be below total');
  }
  return [
    ...(a.until !== undefined ? ['--until', String(a.until)] : []),
    ...(a.shard ? ['--shard', a.shard] : []),
  ];
}
function snapshot(j) {
  return {
    jobId: j.id,
    operation: j.operation,
    status: j.state,
    output: j.rel,
    exitCode: j.code,
    signal: j.signal,
    lastStderr: j.stderr,
    progress: j.progress ?? null,
  };
}
function job(id) {
  const j = history.get(id);
  if (!j) throw Error('unknown job');
  return j;
}
let preparing = false;
async function start(op, a, c) {
  if (active || preparing) throw Error('another background job is active');
  // Hold the slot while asynchronous preflight is in flight.
  preparing = true;
  try {
    return await prepare(op, a, c);
  } finally {
    preparing = false;
  }
}
async function prepare(op, a, c) {
  const script = (f) => path.join(c.repo, f);
  let exe = process.execPath,
    argv,
    dir,
    existing = false;
  if (op === 'start_run') {
    const inline = typeof a.plan !== 'string';
    const plan = inline ? '' : c.input(a.plan);
    dir = c.output(a.out);
    argv = [script('mcp/train.mjs'), c.root, inline ? 'inline' : 'path', plan, dir, ...options(a)];
  } else if (op === 'resume_run' || op === 'rerun' || op === 'start_assessment') {
    const run = await c.archive(a.run);
    exe = await c.nodeFor(run);
    if (op === 'resume_run') {
      existing = true;
      dir = run;
      argv = [path.join(run, 'code/experiment.mjs'), 'resume', run, ...options(a)];
    } else if (op === 'rerun') {
      dir = c.output(a.out);
      argv = [path.join(run, 'code/experiment.mjs'), 'rerun', run, dir, ...options(a)];
    } else {
      dir = c.output(a.out);
      argv = [script('experiment.mjs'), 'assess', run, c.input(a.spec), dir];
    }
  } else {
    dir = c.output(a.out);
    const spec = c.input(a.spec);
    const expected = {collect: ['run'], fit: ['dataset'], score: ['run', 'dataset', 'models']}[a.step];
    for (const k of ['run', 'dataset', 'models'])
      if (expected.includes(k) !== (a[k] !== undefined))
        throw Error('invalid ' + a.step + ' inputs: expected ' + expected.join(', '));
    const parts = [];
    for (const k of expected) {
      if (k === 'run') {
        const r = await c.archive(a.run);
        exe = await c.nodeFor(r);
        parts.push(r);
      } else {
        const d = c.input(a[k]);
        await c.inspectTree(d);
        if (k === 'models') {
          const m = unseal(c.input(path.join(d, 'fit.json'))).body;
          if (
            !Object.hasOwn(m.toolchain.hashes, 'fitter.mjs') ||
            Object.keys(m.toolchain.hashes).some((s) => !/^[-\w]+\.(mjs|bend)$/.test(s)) ||
            m.spec.arms.some((x) => !/^[-\w]+$/.test(x.id))
          )
            throw Error('invalid fitted archive');
        }
        parts.push(d);
      }
    }
    argv = [script('batch.mjs'), a.step, ...parts, spec, dir];
  }
  if (!existing) fs.mkdirSync(dir, {mode: 0o700});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-mcp-job-'));
  let child;
  try {
    if (op === 'start_run' && typeof a.plan !== 'string') {
      const input = path.join(tmp, 'request.json');
      fs.writeFileSync(input, numberPreservingJson(a.plan), {flag: 'wx', mode: 0o600});
      argv[3] = input;
    }
    child = launch(exe, argv, {
      cwd: c.repo,
      env: {...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, BEND_NO_TELEMETRY: '1'},
    });
  } catch (e) {
    fs.rmSync(tmp, {recursive: true, force: true});
    throw e;
  }
  const j = {
    id: randomUUID(),
    operation: op,
    work: Object.fromEntries(
      ['step', 'run', 'dataset', 'models'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]),
    ),
    dir,
    rel: path.relative(c.root, dir),
    state: 'running',
    stderr: '',
    code: null,
    signal: null,
    child,
  };
  active = j;
  history.set(j.id, j);
  if (history.size > 128) history.delete(history.keys().next().value);
  child.stdout.resume();
  child.stderr.on('data', (b) => {
    j.stderr = (j.stderr + b.toString()).slice(-4096);
  });
  child.on('error', (e) => {
    j.stderr = e.message;
  });
  j.done = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      j.code = code;
      j.signal = signal;
      j.state = j.state === 'cancelling' ? 'cancelled' : code === 0 ? 'completed' : 'failed';
      active = null;
      fs.rmSync(tmp, {recursive: true, force: true});
      resolve();
    }),
  );
  return snapshot(j);
}
const make = (n, d, p, r) => tool(d, p, r, false, (a, c) => start(n, a, c));
export const jobs = {
  start_run: make(
    'start_run',
    'Start training in a new directory. Optional shard uses zero-based I/N.',
    {plan: planInput, out: str, until: uint, shard},
    ['plan', 'out'],
  ),
  resume_run: make(
    'resume_run',
    'Resume a trusted archive in place with its recorded Node runtime.',
    {run: str, until: uint, shard},
    ['run'],
  ),
  rerun: make(
    'rerun',
    'Reproduce a trusted archived run in a fresh directory.',
    {run: str, out: str, until: uint, shard},
    ['run', 'out'],
  ),
  start_assessment: make(
    'start_assessment',
    'Run an assessment against a trusted run in a fresh directory.',
    {run: str, spec: str, out: str},
    ['run', 'spec', 'out'],
  ),
  start_offline: make(
    'start_offline',
    'Collect requires run; fit requires dataset; score requires run, dataset and models. Each writes a new directory.',
    {step: choice('collect', 'fit', 'score'), spec: str, out: str, run: str, dataset: str, models: str},
    ['step', 'spec', 'out'],
  ),
  job_status: tool(
    'Show process state and progress: experiment checkpoints (including all shards), assessment evaluations, logged partitions, fitted models or scores.',
    {jobId: str},
    ['jobId'],
    true,
    async (a, c) => {
      const j = job(a.jobId);
      // Coalesce bursts of polling. A transition to completed invalidates a
      // running snapshot so the last poll reports final progress.
      for (let pass = 0; pass < 2; pass++) {
        if (!j.refresh && (j.progressState !== j.state || Date.now() - (j.polledAt ?? 0) > 750)) {
          const stateAtStart = j.state;
          j.refresh = (async () => {
            try {
              j.progress = JSON.parse(
                await c.exec(
                  process.execPath,
                  [
                    '--max-old-space-size=384',
                    path.join(c.repo, 'mcp/progress.mjs'),
                    c.root,
                    j.dir,
                    j.operation,
                    JSON.stringify(j.work),
                  ],
                  {cwd: c.repo, timeout: 12000, maxBytes: 8192},
                ),
              );
            } catch (e) {
              j.progress = {unavailable: e.message};
            } finally {
              j.polledAt = Date.now();
              j.progressState = stateAtStart;
              j.refresh = null;
            }
          })();
        }
        await j.refresh;
        if (j.progressState === j.state) break;
      }
      return snapshot(j);
    },
  ),
  cancel_job: tool(
    'Terminate a job and its process group; wait for exit before releasing the slot.',
    {jobId: str},
    ['jobId'],
    false,
    async (a) => {
      const j = job(a.jobId);
      if (j.state === 'running') {
        killGroup(j.child);
        j.state = 'cancelling';
      }
      await j.done;
      return snapshot(j);
    },
  ),
  select_confirmation: tool(
    'Select confirmation arms from a completed screening run into a new directory.',
    {run: str, spec: str, out: str},
    ['run', 'spec', 'out'],
    false,
    async (a, c) => {
      const r = await c.archive(a.run),
        s = c.input(a.spec),
        d = c.output(a.out);
      fs.mkdirSync(d, {mode: 0o700});
      await c.exec(process.execPath, [path.join(c.repo, 'experiment.mjs'), 'select', r, s, d], {
        timeout: 15000,
      });
      return {
        selection: unseal(path.join(d, 'selection.json')).body,
        plan: JSON.parse(fs.readFileSync(path.join(d, 'plan.json'))),
      };
    },
  ),
};
