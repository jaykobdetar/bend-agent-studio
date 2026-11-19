import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {context, repo} from './context.mjs';
import {choice, horizon, str, tool, planInput, worldInput} from './schema.mjs';
import {armHooks, readPlanSource} from '../core/experiment.mjs';
import {validate} from '../core/experiment_config.mjs';
import {
  worldDefinition,
  oracle,
  reactiveOracle,
  numberPreservingJson,
} from '../core/finite_world.mjs';
import {beliefOracle, clockOracle, policyOracle} from '../core/public_oracle.mjs';
import {memoryWorld} from '../tools/memory_world.mjs';
import {scaffold, sweep} from '../tools/scaffold.mjs';
const table = {
  type: 'object',
  maxProperties: 4096,
  additionalProperties: {
    oneOf: [
      {type: 'integer', minimum: 0},
      {type: 'array', items: {type: 'number', minimum: 0, maximum: 1}, maxItems: 4096},
    ],
  },
};
function shippedWorldSources(plan, bundled) {
  const files = [];
  for (const games of [plan.games, plan.evaluationGames]) {
    if (!Array.isArray(games)) continue;
    for (const game of games) {
      const source = game?.worldFile ?? game?.file;
      const extension = game?.worldFile === undefined ? '.json' : '.bend';
      if (
        typeof source !== 'string' ||
        path.extname(source) !== extension ||
        path.isAbsolute(source)
      )
        continue;
      const full = path.resolve(repo, 'experiments', source);
      const relative = path.relative(repo, full).split(path.sep).join('/');
      if (!relative.startsWith('worlds/')) continue;
      try {
        if (fs.statSync(bundled.input(full)).isFile()) files.push(relative);
      } catch {
        // A missing or unbundled source is not a shipped example.
      }
    }
  }
  return files;
}
export function assertBundledImports(source) {
  for (const line of source.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    if (/\bimport\b/.test(line) && !/^\s*import (?:Base|\.\/[\w-]+\.bend as [\w]+)\s*$/.test(line))
      throw Error('unsupported import in custom Bend source');
  }
}
export function guardedSource(filename, ctx) {
  const guard = (name) => {
    const p = ctx.input(name);
    if (fs.statSync(p).size > 2 ** 22) throw Error('input exceeds 4 MiB');
    return p;
  };
  let p;
  if (typeof filename === 'string') p = readPlanSource(guard(filename), guard);
  else {
    for (const item of [
      ...(filename.games ?? []),
      ...(filename.evaluationGames ?? []),
      ...(filename.arms ?? []),
    ])
      if (['file', 'worldFile', 'agentFile', 'world', 'agent'].some((k) => Object.hasOwn(item, k)))
        throw Error('inline plans must be self-contained data (embed finite or grid definitions)');
    p = filename;
  }
  // Bend sources are code. Allow only the project's ordinary named/relative imports.
  // Paths in bundled local imports have already been rewritten to flat module names.
  // Malformed collections are the native validator's job. Do not turn its
  // actionable field errors into an unrelated "not iterable" exception.
  for (const group of [p.games, p.evaluationGames, p.arms]) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const bundle = item?.world ?? item?.agent;
      for (const text of Object.values(bundle?.files ?? {}))
        if (typeof text === 'string') assertBundledImports(text);
    }
  }
  return p;
}
export function guardedPlan(input, ctx) {
  return validate(guardedSource(input, ctx));
}
function load(p, ctx) {
  const f = ctx.input(p);
  if (fs.statSync(f).size > 4 * 2 ** 20) throw Error('input exceeds 4 MiB');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
export function compute(name, a, ctx) {
  if (name === 'sweep')
    return sweep(a.spec, a.out, {
      input: ctx.input,
      output: ctx.output,
      readSource: (p) => guardedSource(p, ctx),
      halvingRun: a.halvingRun,
    });
  if (name === 'init_agent' || name === 'init_world' || name === 'init_plan')
    return scaffold(ctx.root, name.slice(5), a.name, {bend: a.bend, output: ctx.output});
  if (name === 'validate_plan') {
    const p = guardedPlan(a.plan, ctx);
    const counts = {
      train: Math.max(1, p.maxTrainEpisodes ?? p.checkpoints.at(-1)),
      validation: p.validationEpisodes,
      test: p.testEpisodes,
    };
    return {
      plan: p,
      armHooks: armHooks(p),
      trialCount: p.games.length * p.arms.length * p.replicates,
      seedBlocks: Object.entries(counts)
        .filter(([, n]) => n)
        .map(([phase, n]) => ({
          phase,
          first: p.seeds[phase],
          length: n,
          stride: p.seeds.stride,
          replicates: p.replicates,
        })),
    };
  }
  const w = worldDefinition(typeof a.world === 'string' ? load(a.world, ctx) : a.world);
  if (name === 'validate_world')
    return {
      states: w.states.length,
      observations: new Set(w.states.map((s) => s.observation)).size,
      actions: new Set(w.states.flatMap((s) => s.actions.map((x) => x.id))).size,
      terminalStates: w.states.filter((s) => !s.actions.length).map((s) => s.id),
    };
  if (name === 'solve_world') {
    const f = {full: oracle, reactive: reactiveOracle, history: beliefOracle, clock: clockOracle}[
      a.kind ?? 'full'
    ];
    if (f === oracle || f === reactiveOracle) return f(w, a.horizon);
    return {...oracle(w, a.horizon), ...f(w, a.horizon)};
  }
  if (name === 'evaluate_policy_exact') {
    const policy = (t) => (obs) => {
      if (!Object.hasOwn(t, obs)) throw Error('missing policy observation ' + obs);
      return t[obs];
    };
    return policyOracle(w, a.horizon, policy(a.policy), {
      behavior: a.behavior ? policy(a.behavior) : null,
    });
  }
  if (name === 'build_memory_world') {
    const world = memoryWorld(w, load(a.rules, ctx), {
      maxStates: 20000,
      taskHorizon: a.horizon ?? null,
    });
    if (Buffer.byteLength(JSON.stringify({world})) > 2 ** 20)
      throw Error('generated world exceeds 1 MiB');
    if (a.out) {
      const dir = ctx.output(a.out);
      fs.mkdirSync(dir, {mode: 0o700});
      fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(world), {flag: 'wx'});
    }
    return {world};
  }
  throw Error('unknown worker operation');
}
async function isolated(name, a, ctx) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-mcp-'));
  try {
    const req = path.join(temp, 'request.json');
    fs.writeFileSync(req, numberPreservingJson(a), {mode: 0o600});
    return JSON.parse(
      await ctx.exec(
        process.execPath,
        ['--max-old-space-size=256', path.join(repo, 'mcp/worker.mjs'), name, ctx.root, req],
        {cwd: ctx.root, timeout: 12000, maxBytes: 2 ** 20},
      ),
    );
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
const make = (name, desc, props, required, ro = true) =>
  tool(desc, props, required, ro, (a, c) => isolated(name, a, c));
export const authoring = {
  init_agent: make(
    'init_agent',
    'Create a new scaffold under workspace agents/.',
    {name: str},
    ['name'],
    false,
  ),
  init_world: make(
    'init_world',
    'Create a finite JSON or Bend world under workspace worlds/.',
    {name: str, bend: {type: 'boolean'}},
    ['name'],
    false,
  ),
  init_plan: make(
    'init_plan',
    'Create a new plan under workspace experiments/.',
    {name: str},
    ['name'],
    false,
  ),
  sweep: make(
    'sweep',
    'Expand a sweep spec into a validation-only manifest, or plan the next halving rung from a screening archive.',
    {spec: str, out: str, halvingRun: str},
    ['spec', 'out'],
    false,
  ),
  validate_plan: make(
    'validate_plan',
    'Normalize a training plan and describe its trial count, seed blocks and selected arm hooks.',
    {plan: planInput},
    ['plan'],
  ),
  validate_world: make(
    'validate_world',
    'Expand and validate a finite or grid world.',
    {world: worldInput},
    ['world'],
  ),
  solve_world: make(
    'solve_world',
    'Solve a finite world for the selected information class, alongside its uniform baseline.',
    {world: worldInput, horizon, kind: choice('full', 'reactive', 'history', 'clock')},
    ['world', 'horizon'],
  ),
  evaluate_policy_exact: make(
    'evaluate_policy_exact',
    'Evaluate an observation-to-action (or probability vector) policy; optionally compare behavior support.',
    {world: worldInput, horizon, policy: table, behavior: table},
    ['world', 'horizon', 'policy'],
  ),
  build_memory_world: make(
    'build_memory_world',
    'Construct a memory-augmented world; optional out is a NEW directory for world.json.',
    {world: worldInput, rules: str, horizon, out: str},
    ['world', 'rules'],
    false,
  ),
  list_examples: tool(
    'List bundled example plans, specs, worlds, memory rules and agents.',
    {},
    [],
    true,
    () => {
      const examples = [],
        worldSources = new Set();
      const bundled = context(repo);
      for (const dir of ['experiments', 'worlds', 'agents'])
        for (const file of fs.readdirSync(path.join(repo, dir)).sort()) {
          let rel = dir + '/' + file;
          const entry = fs.lstatSync(path.join(repo, rel));
          if (dir === 'agents' && entry.isDirectory()) {
            rel += '/agent.bend';
            if (!fs.existsSync(path.join(repo, rel))) continue;
          }
          if (!fs.lstatSync(path.join(repo, rel)).isFile()) continue;
          let kind = dir === 'agents' ? 'agent' : 'world';
          if (file.endsWith('.json')) {
            const x = JSON.parse(fs.readFileSync(path.join(repo, rel)));
            if (dir === 'experiments') {
              kind = x.games
                ? 'training plan'
                : x.targets
                  ? 'assess spec'
                  : x.reference
                    ? 'select spec'
                    : x.fitEpisodes
                      ? 'collect spec'
                      : x.arms
                        ? 'fit spec'
                        : 'score spec';
              if (kind === 'training plan')
                for (const source of shippedWorldSources(x, bundled)) worldSources.add(source);
            } else if (x.rules) kind = 'memory rules';
          }
          examples.push({path: rel, kind});
        }
      const listed = new Set(examples.map(({path}) => path));
      for (const path of [...worldSources].sort())
        if (!listed.has(path)) examples.push({path, kind: 'world'});
      return {examples};
    },
  ),
};
