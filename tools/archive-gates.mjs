// Gate G2/G3: real runner/plan resolution without running trials. See archive-gates/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPlan, run, unseal} from '../core/experiment.mjs';
import {canonical, digest} from '../core/experiment_config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = fileURLToPath(new URL('./archive-gates/', import.meta.url));
const flat = /^[\w.-]+\.(mjs|bend)$/;
const sha = /^[a-f0-9]{64}$/;
const sortMap = (pairs) =>
  Object.fromEntries([...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const json = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const fakeBend = 'archive-gates: existing runner test seam (not Bend)';
const stub = 'export default {};\n';
const specs = new Set(
  [
    'car-confirmation',
    'dispatch-exploring',
    'dispatch-fit',
    'dispatch-narrow',
    'dispatch-score',
    'ledge-assessment',
    'pole-checkpoint-assessment',
    'pole-confirmation',
  ].map((name) => 'experiments/' + name + '.json'),
);

function* inputs(directory) {
  for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) yield* inputs(file);
    else if (item.name.endsWith('.json')) {
      assert(item.isFile(), 'Not a regular experiment input: ' + file);
      yield file;
    }
  }
}

function bundleIdentity(bundle) {
  return {
    entry: bundle.entry,
    files: sortMap(Object.entries(bundle.files).map(([name, text]) => [name, digest(text)])),
  };
}

function trainingPlans() {
  return sortMap(
    [...inputs(path.join(root, 'experiments'))].flatMap((file) => {
      const raw = json(file);
      const key = path.relative(root, file).split(path.sep).join('/');
      if (specs.has(key)) {
        assert(
          !Array.isArray(raw.games) || !Array.isArray(raw.arms),
          'A non-training spec became a training plan: ' + key,
        );
        return [];
      }
      assert(
        Array.isArray(raw.games) && Array.isArray(raw.arms),
        'Invalid training manifest or uncataloged non-training spec: ' + key,
      );
      const plan = readPlan(file); // normal readPlanSource + bundleAgent, including evaluationGames
      const references = [
        ...raw.arms.flatMap((a, i) =>
          a.agentFile === undefined ? [] : [['arms/' + a.id, plan.arms[i].agent]],
        ),
        ...['games', 'evaluationGames'].flatMap((field) =>
          (raw[field] ?? []).flatMap((g, i) =>
            g.worldFile === undefined ? [] : [[field + '/' + g.id, plan[field][i].world]],
          ),
        ),
      ];
      return [
        [
          key,
          {
            file,
            plan,
            bundles: sortMap(references.map(([id, b]) => [id, bundleIdentity(b)])),
          },
        ],
      ];
    }),
  );
}

async function inertCompiler(_bend, argv) {
  const [entry, flag, output] = argv;
  if (argv.length === 1 && entry === 'version') return {stdout: fakeBend + '\n'};
  if (argv.length === 2 && flag === '--check-only' && entry.endsWith('.bend')) {
    assert(fs.statSync(entry).isFile());
    return {stdout: ''};
  }
  assert(
    argv.length === 3 &&
      flag === '-o' &&
      path.basename(entry) === 'study.bend' &&
      path.basename(output) === 'study.mjs',
    'Unexpected compiler invocation: ' + argv.join(' '),
  );
  fs.writeFileSync(output, stub, {flag: 'wx'});
  return {stdout: ''};
}

async function snapshot(plan, dir, runProgram, input) {
  // Ordinary run builds and publishes the snapshot. Shard at index count has
  // no trials, so loading the inert backend cannot execute an episode.
  const count = plan.games.length * plan.arms.length * plan.replicates;
  const config = input ?? {
    ...plan,
    arms: plan.arms.map(({buckets, ...arm}) => arm),
  };
  const result = await run(config, dir, ['--shard', count + '/' + (count + 1)], runProgram);
  assert.equal(result.finished, 0, 'gate unexpectedly visited trials');
  assert.equal(result.created, 0, 'gate unexpectedly wrote checkpoints');
  assert(!fs.existsSync(path.join(dir, 'trials')));
  const {
    body: {plan: recorded, toolchain},
  } = unseal(path.join(dir, 'run.json'));
  if (input)
    assert.equal(canonical(recorded), canonical(plan), 'gate recorded a different resolved plan');
  const files = Object.keys(toolchain.sources);
  assert(
    files.every((name) => flat.test(name) && name !== 'backend.mjs'),
    'non-flat or reserved archive name: ' +
      files.filter((name) => !flat.test(name) || name === 'backend.mjs'),
  );
  assert.equal(
    new Set(files.map((name) => name.toLowerCase())).size,
    files.length,
    'case-insensitive archive collision',
  );
  const archived = [...files, 'backend.mjs'].sort();
  assert.deepEqual(
    fs.readdirSync(path.join(dir, 'code')).sort(),
    archived,
    'archive code entries differ',
  );
  for (const name of archived) {
    const bytes = fs.readFileSync(path.join(dir, 'code', name));
    assert.equal(
      digest(bytes),
      name === 'backend.mjs' ? toolchain.backend : toolchain.sources[name],
      name + ' archive SHA mismatch',
    );
    if (name === 'backend.mjs') continue; // opaque production compiler result, not a source dependency
    const text = bytes.toString('utf8');
    const bend = name.endsWith('.bend');
    const edges = bend
      ? text.matchAll(/^[ \t]*import\s+(\.{1,2}\/[^\s]+)\s+as\s+/gm)
      : text.matchAll(
          /^[ \t]*(?:import|export)\s+(?:[^;'"]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gm,
        );
    for (const [, a, b] of edges) {
      const ref = a ?? b;
      // The documented report command runs from the current checkout. Its
      // .mjs/Python/oracle helpers have never been in the archived runner.
      if (name === 'experiment.mjs' && ref === './html_report.mjs') continue;
      assert(
        ref.startsWith('./') && archived.includes(ref.slice(2)),
        name + ' is missing archived import ' + ref,
      );
    }
  }
  return toolchain;
}

async function captureSources(tmp, plans) {
  const entries = [];
  for (const [key, {file, plan, bundles}] of Object.entries(plans)) {
    const output = path.join(tmp, 'out-' + entries.length);
    const t = await snapshot(plan, output, inertCompiler, file);
    assert.equal(t.bend, fakeBend);
    assert.equal(t.backend, digest(stub));
    for (const {files} of Object.values(bundles)) {
      for (const [name, hash] of Object.entries(files))
        assert.equal(t.sources[name], hash, key + ' bundle not archived: ' + name);
    }
    entries.push([
      key,
      {
        plan: digest(canonical(plan)),
        sources: sortMap(Object.entries(t.sources)),
        bundles,
      },
    ]);
  }
  assert(entries.length, 'No training plans found');
  // Store identical entries once. commonSources + sources is the full map for each plan.
  const commonSources = sortMap(
    Object.entries(entries[0][1].sources).filter(([name, hash]) =>
      entries.every(([, data]) => data.sources[name] === hash),
    ),
  );
  for (const [, entry] of entries) {
    entry.sources = sortMap(
      Object.entries(entry.sources).filter(([name]) => !Object.hasOwn(commonSources, name)),
    );
  }
  return {schema: 1, commonSources, plans: sortMap(entries)};
}

function transitioned(before, change, label) {
  assert(change && typeof change === 'object', label + ' must have an exact digest pair');
  assert.deepEqual(
    Object.keys(change).sort(),
    ['after', 'before'],
    label + ' must have an exact digest pair',
  );
  assert(
    before === change.before && sha.test(change.after) && before !== change.after,
    label + ' digest transition mismatch',
  );
  return change.after;
}

function compareSources(saved, actual, allow, transition) {
  assert.equal(saved.schema, actual.schema);
  assert.deepEqual(
    Object.keys(saved.plans),
    Object.keys(actual.plans),
    'training plan inventory changed',
  );
  assert(
    allow && typeof allow === 'object' && !Array.isArray(allow),
    'M0 hash exceptions must be an object',
  );
  const used = new Set();
  for (const name of Object.keys(transition.commonSources))
    assert(Object.hasOwn(saved.commonSources, name), 'Unused F8 common source transition: ' + name);
  for (const [key, entries] of Object.entries(transition.plans)) {
    assert(Object.hasOwn(saved.plans, key), 'Unknown F8 training plan: ' + key);
    for (const name of Object.keys(entries))
      assert(
        Object.hasOwn(saved.plans[key].sources, name),
        'Unused F8 plan source transition: ' + key + ' ' + name,
      );
  }
  for (const [name, change] of Object.entries(allow)) {
    assert(
      flat.test(name) && name.endsWith('.mjs') && name !== 'backend.mjs',
      'M0 exception must name a flat runner .mjs: ' + name,
    );
    assert.deepEqual(
      Object.keys(change).sort(),
      ['after', 'before'],
      'M0 exception requires exact before/after digest: ' + name,
    );
    assert(
      sha.test(change.before) && sha.test(change.after) && change.before !== change.after,
      'Invalid M0 digest pair: ' + name,
    );
  }
  for (const [key, {plan, sources, bundles}] of Object.entries(actual.plans)) {
    const previous = saved.plans[key];
    assert.deepEqual(bundles, previous.bundles, key + ' G3 bundle identity changed');
    assert.equal(plan, previous.plan, key + ' normalized plan changed');
    const before = {...saved.commonSources, ...previous.sources},
      after = {...actual.commonSources, ...sources};
    assert.deepEqual(
      Object.keys(before).sort(),
      Object.keys(after).sort(),
      key + ' G2 archive names changed',
    );
    for (const [name, hash] of Object.entries(before)) {
      let expected = hash;
      if (Object.hasOwn(allow, name)) {
        expected = transitioned(expected, allow[name], key + ' G2 M0 ' + name);
        used.add(name);
      }
      const change = transition.commonSources[name] ?? transition.plans[key]?.[name];
      if (change) expected = transitioned(expected, change, key + ' G2 F8 ' + name);
      assert.equal(after[name], expected, key + ' G2 archive source changed: ' + name);
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(allow).sort(), 'Unused M0 archive hash exception');
}

// Undo only the exact R10.2 changes before applying the independently pinned
// older checks. The round trip checks the current endpoints and the composed
// predecessor (M0 -> F8 for historical plans; original capture for additions).
function undoDelta(after, change, valid, label, allowMissing = false) {
  assert.deepEqual(Object.keys(change).sort(), ['after', 'before'], label);
  for (const value of Object.values(change))
    assert(
      (allowMissing && value === null) || (typeof value === 'string' && valid.test(value)),
      label + ' invalid transition value',
    );
  assert.notEqual(change.before, change.after, label + ' no-op transition');
  assert.equal(after, change.after, label + ' current value differs');
  return change.before;
}

function undoFileMap(files, changes, label) {
  const before = {...files};
  for (const [key, delta] of Object.entries(changes)) {
    assert(flat.test(key) && key !== 'backend.mjs', label + ' invalid file name: ' + key);
    const value = undoDelta(
      Object.hasOwn(before, key) ? before[key] : null,
      delta,
      sha,
      label + ' ' + key,
      true,
    );
    if (value === null) delete before[key];
    else before[key] = value;
  }
  return sortMap(Object.entries(before));
}

function undoR102Sources(report, r102) {
  for (const key of Object.keys(r102.plans))
    assert(Object.hasOwn(report.plans, key), 'R10.2 unknown plan: ' + key);
  return {
    ...report,
    commonSources: {},
    plans: sortMap(
      Object.entries(report.plans).map(([key, input]) => {
        const changes = r102.plans[key] ?? {};
        assert(
          Object.keys(changes).every((k) => ['sources', 'bundles', 'plan'].includes(k)),
          key + ' unknown R10.2 delta',
        );
        if (Object.hasOwn(r102.plans, key))
          assert(Object.keys(changes).length > 0, key + ' empty R10.2 delta');
        const bundleChanges = changes.bundles ?? {};
        const hasBundleChanges = Object.keys(bundleChanges).length > 0;
        assert.equal(
          Object.hasOwn(changes, 'plan'),
          hasBundleChanges,
          key + ' R10.2 normalized plan hash may only move with bundle bytes/identity',
        );
        const sources = {...report.commonSources, ...input.sources};
        for (const name of Object.keys(changes.sources ?? {}))
          assert(
            !Object.hasOwn(r102.commonSources, name),
            key + ' duplicate source delta: ' + name,
          );
        const bundles = {...input.bundles};
        for (const [id, delta] of Object.entries(bundleChanges)) {
          assert(Object.hasOwn(bundles, id), key + ' unknown R10.2 bundle: ' + id);
          assert(
            Object.keys(delta).length > 0 &&
              Object.keys(delta).every((k) => ['entry', 'files'].includes(k)),
            key + ' invalid R10.2 bundle delta: ' + id,
          );
          const label = key + ' R10.2 ' + id;
          const {entry, files} = bundles[id];
          const priorEntry = delta.entry
            ? undoDelta(entry, delta.entry, /^[\w.-]+$/, label + ' entry')
            : entry;
          const priorFiles = undoFileMap(files, delta.files ?? {}, label + ' files');
          assert.notDeepEqual(
            {entry: priorEntry, files: priorFiles},
            {entry, files},
            label + ' no-op bundle transition',
          );
          bundles[id] = {entry: priorEntry, files: priorFiles};
        }
        return [
          key,
          {
            plan: changes.plan
              ? undoDelta(input.plan, changes.plan, sha, key + ' R10.2 plan')
              : input.plan,
            sources: undoFileMap(
              sources,
              {...r102.commonSources, ...changes.sources},
              key + ' R10.2 sources',
            ),
            bundles,
          },
        ];
      }),
    ),
  };
}

function loadR102() {
  const r102 = json(path.join(fixtures, 'r102-transition.json'));
  assert.deepEqual(Object.keys(r102).sort(), [
    'backends',
    'commonSources',
    'plans',
    'predecessor',
    'schema',
  ]);
  assert.equal(r102.schema, 1);
  assert.deepEqual(r102.predecessor, {
    commit: '032375733bb9559d77cea59b812654fd35d5bfe5',
    tree: '30ca2f4622e3c4a91a2a7539fb69525d928ba4bc',
  });
  for (const name of ['backends', 'commonSources', 'plans'])
    assert(r102[name] && typeof r102[name] === 'object' && !Array.isArray(r102[name]));
  return r102;
}

function backendPlans(plans) {
  const from = (name, choose) => {
    const base = plans['experiments/' + name + '.json'].plan;
    return {
      ...base,
      arms: choose(base.arms),
      replicates: 1,
      checkpoints: [0, 1],
      validationEpisodes: 1,
      testEpisodes: 0,
      maxTrainEpisodes: base.budgetUnit === 'episodes' ? 1 : base.maxTrainEpisodes,
    };
  };
  const first = (arms) => arms.slice(0, 1);
  const packed = {
    ...from('bridge', first),
    name: 'archive-gate-packed',
    games: [
      {
        id: 'packed-smoke',
        limit: 2,
        definition: {
          schema: 1,
          initial: [{to: 0, weight: 1}],
          states: Array.from({length: 128}, (_, id) => ({
            id,
            actions: id === 127 ? [] : [{id: 0, outcomes: [{to: id + 1, weight: 1, reward: 0}]}],
          })),
        },
      },
    ],
  };
  return {
    'authored-bend-arena': from('two-pile-nim', first),
    'authored-bend-discrete': from('inventory', first),
    'authored-expanded-finite': from('cue-memory', (arms) => arms), // current and previous observations
    'authored-expanded-grid': from('planning-budget', first), // includes step-budget adapter
    'authored-packed-finite': packed,
    'built-in-cartpole': from('cartpole', first),
    'built-in-discrete-custom-agent': from('custom-bandit', (arms) =>
      arms.filter((a) => a.method === 'custom'),
    ),
    'built-in-mountain-car': from('mountain-car', first),
  };
}

async function captureBackends(tmp, plans) {
  const backends = {};
  let bend;
  for (const [name, plan] of Object.entries(backendPlans(plans))) {
    const t = await snapshot(plan, path.join(tmp, name)); // production compiler; still no trials
    bend ??= t.bend;
    assert.equal(t.bend, bend, 'Bend version changed during backend gate');
    backends[name] = t.backend;
  }
  return {schema: 1, bend, backends};
}

const usage =
  'Usage: node tools/archive-gates.mjs capture | check [M0_HASH_EXCEPTIONS.json] | capture-backends | check-backends';
const [mode, exceptions] = process.argv.slice(2);
const transition = json(path.join(fixtures, 'f8-transition.json'));
assert(
  ['capture', 'check', 'capture-backends', 'check-backends'].includes(mode) &&
    process.argv.length <= (mode === 'check' ? 4 : 3),
  usage,
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-archive-gates-'));
try {
  const plans = trainingPlans();
  if (mode.endsWith('backends')) {
    const report = await captureBackends(tmp, plans);
    if (mode === 'capture-backends') console.log(JSON.stringify(report, null, 2));
    else {
      const expected = json(path.join(fixtures, 'backends.json'));
      for (const [name, change] of Object.entries(transition.backends))
        expected.backends[name] = transitioned(
          expected.backends[name],
          change,
          'G2 F8 backend ' + name,
        );
      for (const [name, change] of Object.entries(loadR102().backends)) {
        assert(Object.hasOwn(expected.backends, name), 'R10.2 unknown backend: ' + name);
        expected.backends[name] = transitioned(
          expected.backends[name],
          change,
          'G2 R10.2 backend ' + name,
        );
      }
      assert.deepEqual(report, expected, 'Representative backend SHA-256 changed');
      console.log(
        'G2 backends: ' +
          Object.keys(report.backends).length +
          ' representative compiler hashes match ' +
          report.bend,
      );
    }
  } else {
    const report = await captureSources(tmp, plans);
    if (mode === 'capture') console.log(JSON.stringify(report, null, 2));
    else {
      const historical = json(path.join(fixtures, 'sources.json'));
      const added = {};
      for (const file of [
        'n9-flagship-plan.json',
        'n9-environment-plans.json',
        'complex-world-plans.json',
        'apex-kart-plan.json',
      ]) {
        for (const [key, entry] of Object.entries(json(path.join(fixtures, file)))) {
          assert(
            !Object.hasOwn(historical.plans, key) && !Object.hasOwn(added, key),
            'duplicate added inventory entry: ' + key,
          );
          added[key] = entry;
        }
      }
      // Plans first published after R10.2 have no historical bytes to restore.
      const flagshipV2 = 'experiments/flagship-toy-text-v2.json';
      const current = json(path.join(fixtures, 'r103-flagship-v2-plan.json'));
      assert.deepEqual(Object.keys(current), [flagshipV2], 'R10.3 inventory must pin only v2');
      assert(!Object.hasOwn(historical.plans, flagshipV2) && !Object.hasOwn(added, flagshipV2));
      const expected = [...Object.keys(historical.plans), ...Object.keys(added), flagshipV2].sort();
      assert.deepEqual(Object.keys(report.plans), expected, 'training plan inventory changed');
      const {[flagshipV2]: v2, ...priorPlans} = report.plans;
      assert.deepEqual(
        {...v2, sources: sortMap(Object.entries({...report.commonSources, ...v2.sources}))},
        current[flagshipV2],
        flagshipV2 + ' post-R10.2 G2/G3 archive identity changed',
      );
      const original = undoR102Sources({...report, plans: priorPlans}, loadR102());
      for (const [key, entry] of Object.entries(added)) {
        const actual = original.plans[key];
        assert.deepEqual(
          {
            ...actual,
            sources: sortMap(Object.entries({...original.commonSources, ...actual.sources})),
          },
          entry,
          key + ' additional G2/G3 archive identity changed',
        );
        delete original.plans[key];
      }
      compareSources(historical, original, exceptions ? json(exceptions) : {}, transition);
      console.log(
        'G2/G3: ' +
          Object.keys(report.plans).length +
          ' training plan archive source maps and bundle identities match',
      );
    }
  }
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
