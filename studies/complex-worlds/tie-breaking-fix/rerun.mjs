// R10.4. Run in the reviewed post-R10.2 checkout; only read trusted local archives.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, digest} from '../../../core/experiment_config.mjs';
import {checkedSnapshot, manifestPath, readPlan, status, unseal} from '../../../core/experiment.mjs';

const previous = '032375733bb9559d77cea59b812654fd35d5bfe5';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const study = 'studies/complex-worlds';
const kart = study + '/kart-transfer';
const pinned = {node: '24.22.3', bend: 'bend 2.0.40'};
const fixed = [
  ['courier', 'experiments/locksmith-courier.json', 48, 192],
  ['switchboard', 'experiments/switchboard.json', 48, 240],
  ['reserve', 'experiments/storm-reserve.json', 48, 192],
  ['kart-transfer', null, 16, 80],
];

const [mode, dirArg, sha, id, ...extra] = process.argv.slice(2);
if (!['prepare', 'run', 'collect'].includes(mode) || !dirArg || !/^[0-9a-f]{40}$/.test(sha ?? '') ||
    extra.length || (mode === 'run' ? !fixed.some(([key]) => key === id) : id !== undefined))
  throw Error('usage: node rerun.mjs (prepare|collect) WORKDIR EXACT_R102_SHA | run WORKDIR EXACT_R102_SHA STUDY');
assert.equal(process.versions.node, pinned.node, 'use the pinned Node executable');
const dir = path.resolve(dirArg),
  plans = fixed.map(([key, file, trials, points]) => ({
    key, file: file ? path.join(root, file) : path.join(dir, 'kart-design', 'plan.json'),
    archive: path.join(dir, 'runs', key), trials, points,
  }));
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const cli = (...args) => execFileSync(process.execPath, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const input = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const write = (filename, data) => fs.writeFileSync(filename, JSON.stringify(data, null, 2) + '\n', {
  flag: 'wx',
});

assert.equal(git('rev-parse', sha + '^{commit}'), sha);
git('merge-base', '--is-ancestor', sha, 'HEAD');
const oldTabular = git('rev-parse', previous + ':core/tabular.bend');
assert.notEqual(git('rev-parse', sha + ':core/tabular.bend'), oldTabular, 'R10.2 tabular change absent');
git('diff', '--exit-code', sha, '--', 'core', 'agents');
git('diff', '--exit-code', previous, '--',
  ...fixed.map(x => x[1]).filter(Boolean), 'worlds/challenges/locksmith',
  'worlds/challenges/switchboard', 'worlds/challenges/storm-reserve',
  'worlds/challenges/apex-kart/kart.mjs', kart + '/design.mjs', kart + '/kart_features.bend',
  kart + '/score.mjs', study + '/results.mjs', study + '/frozen-values.mjs');
const prep = path.join(dir, 'protocol.json');

function contract() {
  return {
    schema: 1, previous, r102: sha, toolchain: pinned,
    plans: Object.fromEntries(plans.map(({key, file, trials, points}) => [
      key, {normalizedPlan: digest(canonical(readPlan(file))), trials, points},
    ])),
  };
}

if (mode === 'prepare') {
  fs.mkdirSync(dir); // no reuse or overwrite of inputs or older archives
  fs.mkdirSync(path.join(dir, 'runs'));
  cli(kart + '/design.mjs', path.join(dir, 'kart-design'));
  write(prep, contract());
  console.log('Locked the four original plans. No model trained or evaluated.');
} else {
  assert.deepEqual(input(prep), contract(), 'prepared inputs no longer match this checkout');
  if (mode === 'run') {
    const selected = plans.find(({key}) => key === id);
    assert(!fs.existsSync(selected.archive), 'refusing an existing output path; resume its archived runner');
    const rc = spawnSync(process.execPath, ['experiment.mjs', 'run', selected.file, selected.archive], {
      cwd: root, stdio: 'inherit',
    });
    if (rc.error) throw rc.error;
    if (rc.status !== 0) throw Error('runner exited ' + (rc.signal ?? rc.status));
  } else collect();
}

function collect() {
  const known = input(prep);
  const archives = Object.fromEntries(plans.map(({key, archive, trials, points}) => {
    const m = unseal(manifestPath(archive)),
      {plan, toolchain} = m.body;
    checkedSnapshot(archive, m);
    assert.equal(digest(canonical(plan)), known.plans[key].normalizedPlan, key + ': plan mismatch');
    for (const [name, value] of Object.entries(pinned)) assert.equal(toolchain[name], value);
    // Snapshot must come from this post-fix checkout, not merely the same plan.
    for (const [file, hash] of Object.entries(toolchain.sources)) {
      const local = path.join(root, 'core', file);
      if (!fs.existsSync(local)) continue;
      const bytes = fs.readFileSync(local);
      if (file === 'study.bend') {
        // The sealed study appends bridges and prepends imports to this template.
        assert.ok(fs.readFileSync(path.join(archive, 'code', file)).includes(bytes), key + ': study template');
      } else assert.equal(hash, digest(bytes), key + ': ' + file);
    }
    assert.notEqual(toolchain.sources['tabular.bend'], undefined, 'missing tabular source');
    const verified = status(archive, true);
    assert.equal(verified.completeTrials, trials);
    assert.equal(verified.totalTrials, trials);
    assert.equal(verified.savedCheckpoints, points);
    assert.equal(verified.totalCheckpoints, points);
    return [key, {runHash: m.hash, toolchain, verified}];
  }));
  const result = cli(study + '/results.mjs', ...plans.slice(0, 3).map(x => x.archive));
  const kartResult = cli(kart + '/score.mjs', plans[3].archive, '--rows');
  const reserveExact = cli(study + '/frozen-values.mjs', plans[2].archive);
  const prior = input(path.join(root, study, 'results.json'));
  const after = JSON.parse(result);
  const priorKart = input(path.join(root, kart, 'results.json'));
  const afterKart = JSON.parse(kartResult);
  assert.deepEqual(afterKart.trainRoads, priorKart.trainRoads);
  assert.deepEqual(afterKart.heldoutTracks, priorKart.heldoutTracks);
  assert.deepEqual(afterKart.targets, priorKart.targets);
  for (let i = 0; i < prior.length; i++) {
    assert.notEqual(prior[i].runHash, after[i].runHash);
    for (const key of ['unit', 'budget', 'checkpoints', 'replicates', 'validationEpisodesPerReplicate', 'testEpisodesPerReplicate'])
      assert.deepEqual(prior[i][key], after[i][key]);
    assert.deepEqual(prior[i].rows.map(x => [x.game, x.arm]), after[i].rows.map(x => [x.game, x.arm]));
  }
  const courier = ({rows, testEpisodesPerReplicate, replicates}) => {
    const arms = Object.fromEntries(['random', 'q', 'dyna'].map(arm => {
      const row = rows.find(x => x.game === 'locksmith-8' && x.arm === arm);
      assert.equal(row.terminal.length, replicates);
      assert.ok(row.illegal.every(n => n === 0));
      assert.ok(row.terminal.every((n, i) => n + row.limited[i] === testEpisodesPerReplicate));
      return [arm, {deliveries: row.terminal.reduce((a, x) => a + x, 0), perFit: row.terminal, returns: row.testMean}];
    }));
    const paired = arms.dyna.returns.map((x, i) => x - arms.q.returns[i]);
    return {
      possible: testEpisodesPerReplicate * replicates, testEpisodesPerReplicate,
      ...arms, dynaMinusQPerFit: paired,
      dynaMinusQ: paired.reduce((s,x) => s+x, 0) / replicates,
    };
  };
  const out = path.join(dir, 'collected');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'results.json'), result, {flag: 'wx'});
  fs.writeFileSync(path.join(out, 'kart-transfer-results.json'), kartResult, {flag: 'wx'});
  fs.writeFileSync(path.join(out, 'reserve-exact.csv'), reserveExact, {flag: 'wx'});
  write(path.join(out, 'identity.json'), {
    ...known, archives, primaryCourier: {before: courier(prior[0]), after: courier(after[0])},
    optionalStormFactorial: 'not rerun',
    separateKartReflectionAblation: 'not rerun',
  });
  console.log('Verified and collected four complete post-fix archives.');
}
