import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {execute} from '../../core/process_output.mjs';
import {digest, verify} from './recording.mjs';

export const MAX_DEMOS = 128;
const MAX_FIT_STEPS = 4096;
const MAX_SCORE_STEPS = 65536;
function bendList(xs) {
  return xs.reduceRight((tail, head) => ({$: 'Con', head, tail}), {$: 'Nil'});
}

function labelsOf(ep) {
  return ep.frames.flatMap((f, i) => {
    const a = ep.annotations ? ep.annotations[i].teacherLabel : f.action;
    return a === null ? [] : [{observation: f.observation, legal: f.legal, action: a}];
  });
}
function frequencies(samples) {
  const counts = new Map();
  for (const f of samples) {
    const row = counts.get(f.observation) ?? new Map();
    row.set(f.action, (row.get(f.action) ?? 0) + 1);
    counts.set(f.observation, row);
  }
  return counts;
}
function rowsOf(counts) {
  const sorted = (map) => [...map].sort(([a], [b]) => a - b);
  return sorted(counts).map(([observation, row]) => ({
    observation,
    counts: sorted(row).map(([action, n]) => ({action, n})),
  }));
}

async function compile(bend, tmp) {
  const options = {env: {...process.env, BEND_NO_TELEMETRY: '1'}, timeout: 60000};
  const version = (await execute(bend, ['version'], options)).stdout.trim();
  if (version !== 'bend 2.0.40') throw Error('demonstration fitting needs Bend 2.0.40');
  const source = fileURLToPath(new URL('./labels.bend', import.meta.url));
  const output = path.join(tmp, 'fitter.mjs');
  await execute(bend, [source, '-o', output], options);
  const sources = [
    'labels.bend',
    '../../core/tabular.bend',
    '../../core/offline.bend',
    '../../core/engine.bend',
    '../../core/dyna.bend',
  ];
  const hashes = Object.fromEntries(
    sources.map((s) => [s, digest(fs.readFileSync(new URL(s, import.meta.url)))]),
  );
  hashes['fitter.mjs'] = digest(fs.readFileSync(output));
  return {
    toolchain: {bend: version, node: process.versions.node, hashes},
    api: (await import(pathToFileURL(output).href)).default,
  };
}

// Fit on all demonstrations; evaluate policies by new simulator episodes, not off-policy estimates.
export async function train(world, records, first, count, bend = process.env.BEND ?? 'bend') {
  if (!records.length || records.length > MAX_DEMOS) throw Error('expected 1–128 demonstrations');
  const demos = records
    .map((record) => ({id: record.sha256, ep: verify(world, record)}))
    .sort((a, b) => a.ep.seed - b.ep.seed);
  const {limit, inputMode} = demos[0].ep;
  const fitSeeds = demos.map((r) => r.ep.seed);
  if (new Set(fitSeeds).size !== demos.length) throw Error('duplicate demonstration seed');
  if (demos.some((r) => r.ep.limit !== limit || r.ep.inputMode !== inputMode))
    throw Error('do not pool demonstrations with different horizons or input modes');
  const ids = new Map(demos.map(({id, ep}) => [id, ep]));
  const samples = demos.flatMap(({ep}) => labelsOf(ep));
  const labels = samples.length;
  const steps = demos.reduce((n, r) => n + r.ep.frames.length, 0);
  if (!labels || steps > MAX_FIT_STEPS)
    throw Error('training needs at least one label and at most 4096 visited steps');
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1024 ||
    count * limit > MAX_SCORE_STEPS ||
    !Number.isSafeInteger(first) ||
    first < 0 ||
    first + count > 2 ** 32
  )
    throw Error('invalid evaluation seed range or evaluation step budget');
  if (fitSeeds.some((s) => s >= first && s < first + count))
    throw Error('evaluation overlaps demonstration seeds');
  for (const {ep} of demos) {
    if (!ep.controller) continue;
    const sources = ep.controller.training.demonstrations.map((d) => {
      const source = ids.get(d.sha256);
      if (!source || source.seed !== d.seed)
        throw Error('aggregation requires the original training demonstration(s) too');
      return source;
    });
    const expected = rowsOf(frequencies(sources.flatMap(labelsOf)));
    if (!isDeepStrictEqual(expected, ep.controller.policy.rows))
      throw Error('frozen controller does not match its referenced training labels');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-demo-fit-'));
  try {
    const {toolchain, api} = await compile(bend, tmp);
    const base = api.empty();
    let model = api.empty();
    const counts = frequencies(samples);
    for (const f of samples) model = api.label(model, f.observation, f.action);
    const rows = rowsOf(counts);
    for (const row of rows)
      for (const {action, n} of row.counts)
        if (api.count(model, row.observation, action) !== n)
          throw Error('Bend and exported frequencies disagree');
    function action(policy, view) {
      return api.choose(policy, view.observation, bendList(view.legal));
    }
    function rollout(policy, seed) {
      const session = world.start(seed, limit);
      let v = session.initial,
        done = v.terminal,
        score = 0,
        ticks = 0,
        unsupported = 0;
      while (!done) {
        if (!v.legal.some((id) => counts.get(v.observation)?.has(id))) unsupported++;
        const result = session.step(action(policy, v));
        const f = result.frame;
        if (!f.accepted) throw Error('fitted policy proposed an illegal action');
        score = Math.fround(score + f.reward);
        if (!Number.isFinite(score)) throw Error('non-finite rollout return');
        ticks++;
        v = {observation: f.nextObservation, legal: f.nextLegal};
        done = result.done;
      }
      return {score, steps: ticks, unsupported, reason: v.legal.length ? 'Limit' : 'Terminal'};
    }
    const paired = Array.from({length: count}, (_, i) => {
      const seed = first + i;
      return {seed, untrained: rollout(base, seed), clone: rollout(model, seed)};
    });
    const mean = (field) => paired.reduce((n, r) => n + r[field].score, 0) / count;
    const wins = paired.filter((r) => r.clone.score > r.untrained.score).length;
    const ties = paired.filter((r) => r.clone.score === r.untrained.score).length;
    const matches = samples.filter((f) => action(model, f) === f.action).length;
    return {
      schema: 'bend-demonstration-fit-v1',
      method: 'behavior_cloning',
      worldSha256: world.sha256,
      limit,
      inputMode,
      toolchain,
      training: {
        demonstrations: demos.map(({id, ep}) => ({sha256: id, seed: ep.seed})),
        steps,
        labels,
        matches,
        learnerStateLabels: demos.reduce(
          (n, {ep}) => n + (ep.annotations?.filter((a) => a.teacherLabel !== null).length ?? 0),
          0,
        ),
        disagreements: demos.reduce(
          (n, {ep}) =>
            n +
            (ep.annotations?.filter(
              (a) => a.teacherLabel !== null && a.teacherLabel !== a.appliedAction,
            ).length ?? 0),
          0,
        ),
        observations: counts.size,
      },
      policy: {
        rule: 'greatest count among current legal actions, first legal on ties or no evidence',
        rows,
      },
      evaluation: {
        firstSeed: first,
        episodes: count,
        untrainedMean: mean('untrained'),
        cloneMean: mean('clone'),
        meanPairedGain: mean('clone') - mean('untrained'),
        wins,
        ties,
        losses: count - wins - ties,
        paired,
      },
    };
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}
