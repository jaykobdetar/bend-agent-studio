import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existing, readPlanSource, unseal} from '../core/experiment.mjs';
import {canonical, trials, validate} from '../core/experiment_config.mjs';
import {numberPreservingJson, worldDefinition} from '../core/finite_world.mjs';

const core = fileURLToPath(new URL('../core/', import.meta.url));
const json = data => numberPreservingJson(data, 2) + '\n';
const identifier = /^[a-z][a-z0-9_-]{0,63}$/;
const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function placeholderWorld() {
  return {schema: 1, initial: [{to: 0, weight: 1}], states: [
    {id: 0, actions: [{id: 0, outcomes: [{to: 1, weight: 1, reward: 1}]}]},
    {id: 1, actions: []},
  ]};
}

function plan(name, arm = {id: 'random', method: 'random'}) {
  return {schema: 1, name, games: [{id: 'one_step', limit: 1, definition: placeholderWorld()}],
    arms: [arm], replicates: 1, checkpoints: [0, 2], validationEpisodes: 2, testEpisodes: 2,
    seeds: {train: 100, validation: 10000, test: 20000, stride: 100}};
}

function checkedDir(root, group, output) {
  const dir = path.join(root, group);
  try {
    fs.mkdirSync(output(dir), {mode: 0o700});
  } catch (error) {
    const existing = fs.lstatSync(dir, {throwIfNoEntry: false});
    if (!existing?.isDirectory() || existing.isSymbolicLink()) throw error;
  }
  return dir;
}

function noOverwrite(file, content) {
  fs.writeFileSync(file, content, {flag: 'wx', mode: 0o600});
}

function coreImport(dir) {
  const relative = path.relative(dir, core).split(path.sep).join('/');
  if (path.isAbsolute(relative) || !/^[\w./-]+$/.test(relative))
    throw Error('Bend source paths must be on the same drive and contain only letters, numbers, _, -, . and /');
  return relative.startsWith('.') ? relative : './' + relative;
}

function render(filename, dir, name) {
  return fs.readFileSync(new URL('scaffold/' + filename + '.txt', import.meta.url), 'utf8')
    .replaceAll('@CORE@', () => coreImport(dir)).replaceAll('@NAME@', name);
}

export function scaffold(root, kind, name, {bend = false, output = x => x} = {}) {
  if (typeof name !== 'string' || !identifier.test(name) || reserved.test(name))
    throw Error('NAME must be a lowercase portable identifier, up to 64 letters, digits, underscores or hyphens');
  if (!['agent', 'world', 'plan'].includes(kind) || (bend && kind !== 'world'))
    throw Error('usage: node experiment.mjs init agent|world|plan NAME [--bend (world only)]');
  const dir = checkedDir(root, {agent: 'agents', world: 'worlds', plan: 'experiments'}[kind], output);
  if (kind === 'agent') {
    const destination = output(path.join(dir, name));
    const files = Object.fromEntries(['agent.bend', 'laws.bend', 'proof.bend', 'checks.bend', 'README.md']
      .map(filename => [filename, render(filename, destination, name)]));
    files['example.json'] = json(plan(name, {id: name, method: 'custom', agentFile: 'agent.bend'}));
    fs.mkdirSync(destination, {mode: 0o700});
    for (const [filename, data] of Object.entries(files))
      noOverwrite(output(path.join(destination, filename)), data);
    return {created: Object.keys(files).map(filename => path.relative(root, path.join(destination, filename)))};
  }
  const filename = output(path.join(dir, name + (bend ? '.bend' : '.json')));
  const data = kind === 'plan' ? validate(plan(name)) : bend ? null : placeholderWorld();
  if (kind === 'world' && !bend) worldDefinition(data);
  // Emit the human-readable raw plan, not the normalized runner representation.
  noOverwrite(filename, kind === 'plan' ? json(plan(name)) : bend ? render('world.bend', dir, name) : json(data));
  return {created: [path.relative(root, filename)]};
}

const keys = (obj, allowed, label) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error(label + ' must be an object');
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) throw Error(label + ': unknown field ' + key);
};
const uint32 = value => Number.isInteger(value) && value >= 0 && value < 2 ** 32;

function sampleIndices(total, count, seed) {
  // Seed is only for design generation, never for train/validation/test blocks.
  const indices = Array.from({length: total}, (_, i) => i);
  let word = seed;
  for (let i = 0; i < count; i++) {
    word = (Math.imul(word, 1664525) + 1013904223) >>> 0;
    const j = i + Math.floor(word * (total - i) / 2 ** 32);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count);
}

export function expandSweep(spec, source) {
  keys(spec, ['schema', 'plan', 'arm', 'grid', 'random', 'halving'], 'sweep spec');
  if (spec.schema !== 1 || typeof spec.plan !== 'string' || !spec.plan || typeof spec.arm !== 'string')
    throw Error('sweep requires schema 1, a plan path and a source arm id');
  const base = validate(source);
  const arm = source.arms.find(a => a.id === spec.arm);
  if (!arm) throw Error('sweep source arm not found: ' + spec.arm);
  const axes = Object.keys(spec.grid ?? {}).sort();
  keys(spec.grid, axes, 'grid');
  if (!axes.length || axes.length > 16) throw Error('sweep grid must contain 1–16 axes');
  const standard = ['alpha', 'gamma', 'epsilon', 'criticRate', 'planningSteps'];
  let total = 1;
  for (const key of axes) {
    if (arm.method === 'custom' ? !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) : !standard.includes(key))
      throw Error('invalid sweep parameter: ' + key);
    const values = spec.grid[key];
    if (!Array.isArray(values) || values.length < 1 || values.length > 4096 ||
        !values.every(x => typeof x === 'number' && Number.isFinite(x)) ||
        new Set(values).size !== values.length) throw Error('invalid or duplicate sweep values: ' + key);
    total *= values.length;
    if (total > 65536) throw Error('sweep grid exceeds 65,536 combinations');
  }
  let indices;
  if (spec.random !== undefined) {
    keys(spec.random, ['seed', 'count'], 'random search');
    const {seed, count} = spec.random;
    if (!uint32(seed) || !Number.isInteger(count) || count < 1 || count > Math.min(512, total))
      throw Error('random search requires a U32 seed and a count within the grid, at most 512');
    indices = sampleIndices(total, count, seed);
  } else {
    if (total > 512) throw Error('grid sweep exceeds 512 arms; use seeded random search');
    indices = Array.from({length: total}, (_, n) => n);
  }
  const generated = indices.map(index => {
    const entries = [];
    for (const key of axes) {
      const values = spec.grid[key];
      entries.push([key, values[index % values.length]]);
      index = Math.floor(index / values.length);
    }
    const changes = Object.fromEntries(entries);
    const variant = arm.method === 'custom' ? {...arm, parameters: {...arm.parameters, ...changes}} : {...arm, ...changes};
    return variant;
  }).map((variant, i) => ({...variant, id: 'sweep_' + String(i + 1).padStart(3, '0')}));
  if (base.games.length !== 1 || base.evaluationGames?.length)
    throw Error('screening sweep requires one training game and no transfer games');
  const result = {...source, arms: generated, testEpisodes: 0};
  const normalized = validate(result);
  // Execution uses quantized exploration buckets, not the original epsilon.
  const unique = new Set(normalized.arms.map(({id, epsilon, ...setting}) => canonical(setting)));
  if (unique.size !== generated.length) throw Error('sweep candidates collapse to duplicate runner settings');
  if (spec.halving !== undefined) halvingRungs(spec.halving, normalized);
  return result;
}

function halvingRungs(opts, plan) {
  keys(opts, ['factor', 'checkpoints'], 'halving');
  const {factor = 2, checkpoints} = opts;
  if (!Number.isInteger(factor) || factor < 2 || factor > 8 ||
      !Array.isArray(checkpoints) || checkpoints.length < 2 || checkpoints.length > 12 ||
      checkpoints.some((n, i) => !plan.checkpoints.includes(n) || n < 1 || (i > 0 && n <= checkpoints[i - 1])))
    throw Error('halving requires 2–12 increasing positive existing checkpoints and factor 2–8');
  if (checkpoints.at(-1) !== plan.checkpoints.at(-1))
    throw Error('the last halving rung must be the plan’s final checkpoint');
  if (plan.arms.length < 2 || plan.arms.length * plan.replicates > 128 || plan.checkpoints.length > 32)
    throw Error('halving requires at least two arms, at most 128 trials, and at most 32 checkpoints');
  return {factor, checkpoints};
}

function checkpoint(root, manifest, t, budget, input) {
  let previous = null;
  for (const n of manifest.body.plan.checkpoints) {
    if (n > budget) break;
    const f = path.join(root, 'trials', t.game.id, t.arm.id, String(t.rep), n + '.json');
    const found = fs.lstatSync(f, {throwIfNoEntry: false});
    if (!found) return null;
    if (!found.isFile() || found.size > 16 * 2 ** 20) throw Error('invalid checkpoint file');
    input(f); // apply the MCP directory/link policy without executing archived code
    const row = existing(root, manifest.hash, t, n, previous);
    const v = row.body.validation;
    if (row.body.test !== null || !v || !Number.isFinite(v.sum) || v.episodes !== manifest.body.plan.validationEpisodes)
      throw Error('invalid screening checkpoint: expected validation-only data');
    previous = row.hash;
    if (n === budget) return v.sum / v.episodes;
  }
  return null;
}

function halvingDecision(spec, manifest, root, input) {
  const plan = validate(manifest);
  const {factor, checkpoints} = halvingRungs(spec.halving, plan);
  const mf = input(path.join(root, 'run.json'));
  if (!fs.statSync(mf).isFile() || fs.statSync(mf).size > 16 * 2 ** 20)
    throw Error('invalid screening run manifest');
  const saved = unseal(mf);
  if (saved.body?.plan?.testEpisodes !== 0 || canonical(saved.body.plan) !== canonical(plan))
    throw Error('run is not the exact validation-only sweep plan');
  const ordered = [...trials(plan)];
  let active = new Set(plan.arms.map(a => a.id));
  const stages = [];
  for (const budget of checkpoints) {
    const scores = new Map([...active].map(id => [id, 0]));
    const next = [];
    for (const [index, t] of ordered.entries()) {
      if (!active.has(t.arm.id)) continue;
      const score = checkpoint(root, saved, t, budget, input);
      if (score === null) {
        next.push({arm: t.arm.id, replicate: t.rep, until: budget, shard: index + '/' + ordered.length});
      } else {
        scores.set(t.arm.id, scores.get(t.arm.id) + score / plan.replicates);
      }
    }
    if (next.length) return {runHash: saved.hash, stages, next};
    const ranking = [...scores].map(([arm, meanReturn]) => ({arm, meanReturn}))
      .sort((a, b) => b.meanReturn - a.meanReturn || (a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : 0));
    const final = budget === checkpoints.at(-1);
    active = new Set(ranking.slice(0, final ? 1 : Math.ceil(active.size / factor)).map(x => x.arm));
    stages.push({budget, ranking, survivors: [...active]});
    if (final) return {runHash: saved.hash, stages, next: [], winner: ranking[0].arm};
  }
}

export function sweep(specPath, out, {input = x => x, output = x => x, readSource = readPlanSource, halvingRun} = {}) {
  const sourcePath = input(specPath);
  if (!fs.statSync(sourcePath).isFile() || fs.statSync(sourcePath).size > 2 ** 20)
    throw Error('sweep specification must be a regular JSON file within 2 MiB');
  const spec = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (typeof spec?.plan !== 'string' || !spec.plan) throw Error('sweep requires a plan path');
  const source = readSource(input(path.resolve(path.dirname(sourcePath), spec.plan)));
  const manifest = expandSweep(spec, source);
  const destination = output(out);
  let result;
  if (halvingRun !== undefined) {
    if (spec.halving === undefined) throw Error('halving mode requires a halving spec');
    result = halvingDecision(spec, manifest, input(halvingRun), input);
  }
  const content = json(result ?? manifest);
  if (Buffer.byteLength(content) > 4 * 2 ** 20) throw Error('generated sweep manifest exceeds 4 MiB');
  noOverwrite(destination, content);
  return result ?? {arms: manifest.arms.length, testEpisodes: 0};
}
