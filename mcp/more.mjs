import fs from 'node:fs';
import {assertBundledImports} from './authoring.mjs';
import path from 'node:path';
import os from 'node:os';
import {tool, choice, str, uint} from './schema.mjs';
import {bundleAgent} from '../agent_source.mjs';
import {unseal} from '../experiment.mjs';
const script = (c, f) => path.join(c.repo, f),
  py = process.platform === 'win32' ? 'python' : 'python3';
const phase = choice('train', 'validation', 'test'),
  metric = choice('return', 'steps', 'completion', 'timeout', 'illegal', 'reward_per_step');
const scratch = async (fn) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-mcp-inspect-'));
  try {
    return await fn(d);
  } finally {
    fs.rmSync(d, {recursive: true, force: true});
  }
};
async function stat(c, r) {
  return JSON.parse(
    await c.exec(process.execPath, [script(c, 'experiment.mjs'), 'verify', r], {
      cwd: c.repo,
      timeout: 12000,
    }),
  );
}
export const more = {
  verify_run: tool(
    'Verify the snapshot, checkpoint chains, and complete metrics of a trusted run.',
    {run: str},
    ['run'],
    true,
    async (a, c) => ({verified: true, ...(await stat(c, await c.archive(a.run)))}),
  ),
  list_runs: tool(
    'Inspect at most 16 direct child runs per page; verify each snapshot and checkpoint chain.',
    {root: str, offset: uint, limit: {type: 'integer', minimum: 1, maximum: 16}},
    ['root'],
    true,
    async (a, c) => {
      const parent = c.input(a.root),
        names = fs
          .readdirSync(parent, {withFileTypes: true})
          .filter(
            (e) =>
              e.isDirectory() &&
              fs.lstatSync(path.join(parent, e.name, 'run.json'), {throwIfNoEntry: false}),
          )
          .map((e) => e.name)
          .sort();
      const start = a.offset ?? 0,
        end = start + (a.limit ?? 8),
        runs = [];
      for (const name of names.slice(start, end)) {
        const row = {name, verified: false};
        try {
          const d = await c.archive(path.join(parent, name)),
            m = unseal(path.join(d, 'run.json'));
          row.node = m.body.toolchain.node;
          row.experimentName = m.body.plan.name;
          row.progress = JSON.parse(
            await c.exec(process.execPath, [script(c, 'experiment.mjs'), 'status', d], {timeout: 5000}),
          );
          row.complete = row.progress.completeTrials === row.progress.totalTrials;
          await stat(c, d);
          row.verified = true;
        } catch (e) {
          row.error = e.message;
        }
        runs.push(row);
      }
      return {runs, nextOffset: end < names.length ? end : null};
    },
  ),
  get_checkpoint: tool(
    'Inspect verified checkpoint metrics and model lineage. Model is opt-in and limited to 128 KiB.',
    {run: str, game: str, arm: str, replicate: uint, checkpoint: uint, includeModel: {type: 'boolean'}},
    ['run', 'game', 'arm', 'replicate', 'checkpoint'],
    true,
    async (a, c) => {
      const d = await c.archive(a.run);
      return JSON.parse(
        await c.exec(
          process.execPath,
          [
            '--max-old-space-size=384',
            script(c, 'mcp/checkpoint.mjs'),
            d,
            a.game,
            a.arm,
            String(a.replicate),
            String(a.checkpoint),
            a.includeModel ? 'yes' : 'no',
          ],
          {timeout: 12000, maxBytes: 512 * 1024},
        ),
      );
    },
  ),
  sequential_test: tool(
    'Compute anytime-valid paired evidence from JSON containing {design,rows} in prospective replicate order.',
    {file: str},
    ['file'],
    true,
    async (a, c) => {
      const f = c.input(a.file);
      if (fs.statSync(f).size > 2 ** 20) throw Error('design exceeds 1 MiB');
      return JSON.parse(
        await c.exec(process.execPath, [script(c, 'sequential.mjs'), f], {timeout: 12000}),
      );
    },
  ),
  arena_tournament: tool(
    'Analyze the shipped deterministic arenas; return exploitability and cross-play tables without modifying the run.',
    {run: str},
    ['run'],
    true,
    async (a, c) =>
      scratch(async (d) => {
        const r = await c.archive(a.run);
        const summary = JSON.parse(
          await c.exec(await c.nodeFor(r), [script(c, 'arena_tournament.mjs'), r, d], {timeout: 30000}),
        );
        function table(name) {
          const f = path.join(d, name + '.csv');
          if (fs.statSync(f).size > 400000) throw Error('tournament table exceeds response limit');
          const [head, ...lines] = fs.readFileSync(f, 'utf8').trimEnd().split(/\r?\n/),
            keys = head.split(',');
          return lines.map((l) =>
            Object.fromEntries(
              l
                .split(',')
                .map((v, i) => [
                  keys[i],
                  ['game', 'arm', 'first', 'second', 'checkpoint_hash'].includes(keys[i])
                    ? v
                    : Number(v),
                ]),
            ),
          );
        }
        return {summary, ratings: table('ratings'), crossplay: table('crossplay')};
      }),
  ),
  learning_curve: tool(
    'Compute replicate-level learning curves. Optional svgOut is a NEW directory for curve.svg; SVG requires matplotlib.',
    {
      run: str,
      phase,
      metric,
      reference: str,
      draws: {type: 'integer', minimum: 100, maximum: 10000},
      svgOut: str,
    },
    ['run'],
    false,
    async (a, c) =>
      scratch(async (d) => {
        const r = await c.archive(a.run),
          csv = path.join(d, 'data.csv'),
          out = a.svgOut ? c.output(a.svgOut) : null;
        fs.writeFileSync(
          csv,
          await c.exec(process.execPath, [script(c, 'experiment.mjs'), 'export', r], {
            timeout: 30000,
            maxBytes: 8 * 2 ** 20,
          }),
        );
        const args = [
          csv,
          a.phase ?? 'validation',
          a.metric ?? 'return',
          a.reference ?? '',
          String(a.draws ?? 2000),
        ];
        const result = JSON.parse(
          await c.exec(py, ['-I', script(c, 'mcp/curves.py'), ...args], {cwd: c.repo, timeout: 30000}),
        );
        if (out) {
          const svg = path.join(d, 'curve.svg');
          await c.exec(py, ['-I', script(c, 'mcp/curves.py'), ...args, svg], {
            cwd: c.repo,
            timeout: 30000,
          });
          fs.mkdirSync(out, {mode: 0o700});
          fs.copyFileSync(svg, path.join(out, 'curve.svg'), fs.constants.COPYFILE_EXCL);
          result.svg = path.relative(c.root, path.join(out, 'curve.svg'));
        }
        return result;
      }),
  ),
  check_bend: tool(
    'Type-check a custom Bend module in an isolated build directory. Supports Base and ordinary relative imports.',
    {file: str},
    ['file'],
    true,
    async (a, c) =>
      scratch(async (d) => {
        const file = c.input(a.file);
        if (!file.endsWith('.bend')) throw Error('expected .bend input');
        const bundle = bundleAgent(file, c.repo, (n) => {
          const p = c.input(n);
          if (fs.statSync(p).size > 2 ** 20) throw Error('source exceeds size limit');
          return p;
        });
        for (const [name, source] of Object.entries(bundle.files)) {
          assertBundledImports(source);
          fs.writeFileSync(path.join(d, name), source, {flag: 'wx'});
        }
        for (const e of fs.readdirSync(c.repo, {withFileTypes: true}))
          if (e.isFile() && e.name.endsWith('.bend'))
            fs.copyFileSync(script(c, e.name), path.join(d, e.name), fs.constants.COPYFILE_EXCL);
        await c.exec(
          process.env.BEND ?? 'bend',
          [path.join(d, bundle.entry + '.bend'), '--check-only'],
          {cwd: d, timeout: 15000},
        );
        return {valid: true};
      }),
  ),
};
