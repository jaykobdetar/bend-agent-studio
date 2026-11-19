import {numberPreservingJson} from '../core/finite_world.mjs';
import {publicTraceFrames} from '../core/public_oracle.mjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const str = {type: 'string', minLength: 1, maxLength: 1024};
const uint = {type: 'integer', minimum: 0, maximum: 4294967295};
const object = (properties, required) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const cap = 4 * 1024 * 1024;
function integer(n, min, max, label) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Invalid ' + label);
  return n;
}
function id(s) {
  if (typeof s !== 'string' || !s.length || s.length > 128 || /[\\/\0]/.test(s))
    throw Error('Invalid game or arm ID');
  return s;
}
function tool(description, inputSchema, run) {
  return {description, inputSchema, readOnly: true, run};
}
const coords = {
  run: str,
  game: str,
  arm: str,
  replicate: uint,
  checkpoint: uint,
  phase: {enum: ['train', 'validation', 'test'], type: 'string'},
  episode: uint,
};
const page = {offset: uint, limit: {type: 'integer', minimum: 1, maximum: 250}};
const phases = ['train', 'validation', 'test'];
const metrics = ['return', 'steps', 'completion', 'timeout', 'illegal', 'reward_per_step'];
async function replay(a, ctx, dir) {
  if (!phases.includes(a.phase)) throw Error('Invalid replay phase');
  const args = [
    path.join(dir, 'code', 'experiment.mjs'),
    'replay',
    dir,
    id(a.game),
    id(a.arm),
    String(integer(a.replicate, 0, 4294967295, 'replicate')),
    String(integer(a.checkpoint, 0, 4294967295, 'checkpoint')),
    a.phase,
    String(integer(a.episode, 0, 4294967295, 'episode')),
  ];
  return JSON.parse(
    await ctx.exec(await ctx.nodeFor(dir), args, {cwd: dir, timeout: 30000, maxBytes: 16 * 1024 * 1024}),
  );
}
function paginate(items, a) {
  const offset = integer(a.offset ?? 0, 0, 4294967295, 'offset'),
    limit = integer(a.limit ?? 50, 1, 250, 'limit');
  // Bound the serialized page even for custom observations with large payloads.
  let bytes = 0;
  const slice = [];
  for (const item of items.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (size > 256 * 1024) throw Error('A single item exceeds the response size limit');
    if (bytes + size > 256 * 1024) break;
    slice.push(item);
    bytes += size;
  }
  return {
    offset,
    total: items.length,
    nextOffset: offset + slice.length < items.length ? offset + slice.length : null,
    slice,
  };
}
export const inspection = {
  replay_episode: tool(
    'Reconstruct an archived episode with its recorded Node version. Return summary and one bounded page of frames; indices start at zero.',
    object({...coords, ...page}, Object.keys(coords)),
    async (a, ctx) => {
      const {frames, ...summary} = await replay(a, ctx, await ctx.archive(a.run));
      const {slice, ...pagination} = paginate(frames, a);
      return {...summary, frames: slice, ...pagination};
    },
  ),
  summarize_results: tool(
    'Analyze complete replicate blocks by game, budget and arm using analyze.py. Optional reference gives paired differences. A single replicate has no confidence interval or standard deviation.',
    object(
      {
        run: str,
        phase: {type: 'string', enum: phases},
        metric: {type: 'string', enum: metrics},
        reference: str,
        draws: {type: 'integer', minimum: 100, maximum: 10000},
      },
      ['run'],
    ),
    async (a, ctx) => {
      const dir = await ctx.archive(a.run),
        phase = a.phase ?? 'test',
        metric = a.metric ?? 'return';
      if (!phases.includes(phase) || !metrics.includes(metric))
        throw Error('Invalid analysis phase or metric');
      const csv = await ctx.exec(
        process.execPath,
        [path.join(ctx.repo, 'experiment.mjs'), 'export', dir],
        {cwd: ctx.repo, timeout: 30000, maxBytes: 8 * 1024 * 1024},
      );
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-mcp-analysis-'));
      try {
        const file = path.join(tmp, 'export.csv');
        await fs.writeFile(file, csv, {mode: 0o600});
        const args = [
          '-I',
          path.join(ctx.repo, 'analyze.py'),
          file,
          '--phase',
          phase,
          '--metric',
          metric,
          '--draws',
          String(integer(a.draws ?? 2000, 100, 10000, 'draws')),
        ];
        if (a.reference !== undefined) args.push('--reference=' + id(a.reference));
        const out = await ctx.exec(process.platform === 'win32' ? 'python' : 'python3', args, {
          cwd: ctx.repo,
          timeout: 30000,
          maxBytes: cap,
        });
        const [head, ...lines] = out.trimEnd().split(/\r?\n/);
        if (
          head !==
          'game,budget,arm,reference,phase,metric,replicates,estimate,ci_low,ci_high,replicate_sd'
        )
          throw Error('Unrecognized analysis output');
        const numeric = (v) => (v === '' ? null : Number(v));
        const rows = lines.map((line) => {
          const [game, budget, arm, ref, phase, metric, n, estimate, lo, hi, sd] = line.split(',');
          return {
            game,
            budget: Number(budget),
            arm,
            reference: ref || null,
            phase,
            metric,
            replicates: Number(n),
            estimate: Number(estimate),
            interval: [numeric(lo), numeric(hi)],
            sd: numeric(sd),
          };
        });
        return {rows};
      } finally {
        await fs.rm(tmp, {recursive: true, force: true});
      }
    },
  ),
  explain_episode: tool(
    'Replay a finite-world episode and audit chosen actions against the optimal public-history policy. Returns per-decision value gaps in pages.',
    object(
      {...coords, ...page, discount: {type: 'number', minimum: 0, maximum: 1}},
      Object.keys(coords),
    ),
    async (a, ctx) => {
      const dir = await ctx.archive(a.run);
      const manifest = JSON.parse(await fs.readFile(ctx.input(path.join(dir, 'run.json')), 'utf8'));
      const game = manifest.body.plan.games.find((g) => g.id === a.game);
      if (!game?.definition) throw Error('Decision explanation requires an authored finite world');
      const discount = a.discount ?? 1;
      if (!Number.isFinite(discount) || discount < 0 || discount > 1) throw Error('Invalid discount');
      const {frames} = await replay(a, ctx, dir);
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-mcp-explain-'));
      try {
        const world = path.join(tmp, 'world.json'),
          trace = path.join(tmp, 'trace.json');
        const arm=manifest.body.plan.arms?.find(x=>x.id===a.arm);
        const source=publicTraceFrames(game.definition,frames,arm?.observation);
        await fs.writeFile(world, numberPreservingJson(game.definition), {mode: 0o600});
        await fs.writeFile(trace, numberPreservingJson({frames:source}), {mode: 0o600});
        const out = await ctx.exec(
          process.execPath,
          [
            path.join(ctx.repo, 'public_oracle.mjs'),
            world,
            String(game.limit),
            '--trace',
            trace,
            '--discount',
            String(discount),
            '--max-beliefs',
            '20000',
          ],
          {cwd: ctx.repo, timeout: 15000, maxBytes: cap},
        );
        const {decisions, ...summary} = JSON.parse(out),
          {slice, ...pagination} = paginate(decisions, a);
        return {...summary, decisions: slice.map(d=>({...d,observation:frames[d.step].observation})), ...pagination};
      } finally {
        await fs.rm(tmp, {recursive: true, force: true});
      }
    },
  ),
};
