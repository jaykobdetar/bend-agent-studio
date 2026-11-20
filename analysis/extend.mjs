// Host-only preregistered validation stopping. Archives keep their original runner.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {canonical, digest, seedOf} from '../core/experiment_config.mjs';
import {
  checkedSnapshot,
  existing,
  immutable,
  manifestPath,
  seal,
  unseal,
} from '../core/experiment.mjs';
import {sequentialPaired} from './sequential.mjs';

// Reviewed 62decf6 archive runner ABI. Do not infer compatibility solely
// from a callable export; a later runner needs an explicit parity review.
const runnerABI = '68902cc4319ad39b40ca0c288da1b6d94184904f19921649ece9e50c5a99e5b4';
const checkout = fileURLToPath(new URL('../', import.meta.url));
const sha = /^[0-9a-f]{64}$/;
const gitSha = /^[0-9a-f]{40}$/;
const label = /^[a-z][a-z0-9_-]{0,79}$/;
const flatSource = /^[\w.-]+\.(mjs|bend)$/;

function files(dir, required = true) {
  const meta = fs.lstatSync(dir, {throwIfNoEntry: false});
  if (!meta && !required) return [];
  if (!meta?.isDirectory()) throw Error('expected regular directory: ' + dir);
  return fs.readdirSync(dir, {withFileTypes: true});
}

function readRecord(file) {
  const meta = fs.lstatSync(file);
  if (!meta.isFile() || meta.size > 16_384) throw Error('invalid sequential record');
  return unseal(file);
}

function committedSpecification(file) {
  const real = fs.realpathSync(file),
    relative = path.relative(checkout, real);
  if (
    real !== file ||
    !relative ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    throw Error('use a committed, regular spec in this checkout');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 16_384) throw Error('invalid sequential specification file');
  const bytes = fs.readFileSync(file);
  const git = (...args) =>
    execFileSync('git', ['-C', checkout, ...args], {
      maxBuffer: 16_384,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commit = git('rev-parse', 'HEAD').toString().trim();
  try {
    if (!git('show', commit + ':' + relative).equals(bytes)) throw Error('working bytes differ');
  } catch {
    throw Error('sequential spec must match the bytes committed in the current checkout');
  }
  return {
    spec: JSON.parse(bytes),
    source: {relative, sha256: digest(bytes), commit},
    verifyOriginal: (old) => {
      if (!gitSha.test(old.commit) || old.relative !== relative || old.sha256 !== digest(bytes))
        throw Error('sequential specification differs from the registered one');
      git('merge-base', '--is-ancestor', old.commit, commit);
      if (!git('show', old.commit + ':' + relative).equals(bytes))
        throw Error('registered spec commit differs');
    },
  };
}

function contract(spec, plan) {
  if (
    !spec ||
    Object.keys(spec).sort().join('|') !==
      'candidate|checkpoint|design|game|maximum|metric|planSha256|reference|schema' ||
    spec.schema !== 1 ||
    spec.metric !== 'validation_return' ||
    !sha.test(spec.planSha256) ||
    digest(canonical(plan)) !== spec.planSha256 ||
    plan.games.length !== 1 ||
    plan.arms.length !== 2 ||
    plan.evaluationGames?.length ||
    plan.testEpisodes !== 0 ||
    spec.game !== plan.games[0].id ||
    ![spec.game, spec.candidate, spec.reference].every((x) => label.test(x)) ||
    spec.candidate === spec.reference ||
    ![spec.candidate, spec.reference].every((id) => plan.arms.some((a) => a.id === id)) ||
    spec.maximum !== plan.replicates ||
    !Number.isSafeInteger(spec.maximum) ||
    spec.maximum < 2 ||
    spec.maximum > 64 ||
    spec.checkpoint !== plan.checkpoints.at(-1) ||
    spec.checkpoint < 1 ||
    !spec.design ||
    Object.keys(spec.design).sort().join('|') !== 'alpha|lower|margin|upper'
  )
    throw Error('sequential spec disagrees with the fixed two-arm validation-only plan');
  if (!Number.isSafeInteger(plan.validationEpisodes) || plan.validationEpisodes < 1)
    throw Error('sequential stopping requires at least one validation episode');
  sequentialPaired([], spec.design); // Validate bounds and nominal level before making any results.
}

function inspectTrialPaths(root, plan, authorized) {
  const dir = path.join(root, 'trials'),
    [game] = plan.games;
  const last = [];
  for (const g of files(dir, false)) {
    if (!g.isDirectory() || g.name !== game.id) throw Error('unexpected training output path');
    for (const a of files(path.join(dir, g.name))) {
      if (!a.isDirectory() || !plan.arms.some((arm) => arm.id === a.name))
        throw Error('unexpected training output path');
      for (const r of files(path.join(dir, g.name, a.name))) {
        if (!r.isDirectory() || !/^(0|[1-9]\d*)$/.test(r.name) || Number(r.name) >= authorized)
          throw Error('pre-existing evidence beyond the authorized sequential prefix');
        const entries = files(path.join(dir, g.name, a.name, r.name));
        // Only presence/shape is inspected here, not scores. A force-killed
        // worker's stray temporary output is a mismatch that stops the run.
        if (Number(r.name) === authorized - 1)
          last[plan.arms.findIndex((arm) => arm.id === a.name)] = entries.length;
        const prefix = new Set(plan.checkpoints.slice(0, entries.length).map((n) => n + '.json'));
        if (entries.some((e) => !e.isFile() || !prefix.delete(e.name)) || prefix.size)
          throw Error('non-contiguous or foreign checkpoint files');
      }
    }
  }
  if (last[1] && last[0] !== plan.checkpoints.length)
    throw Error('second arm started before its paired first arm completed');
}

function readTrial(root, manifest, game, arm, rep, allowPartial) {
  const plan = manifest.body.plan;
  let parent = null,
    final = null;
  for (const n of plan.checkpoints) {
    const cp = existing(root, manifest.hash, {game, arm, rep}, n, parent);
    if (!cp) {
      if (allowPartial) return null;
      throw Error('previously authorized replicate is incomplete');
    }
    parent = cp.hash;
    final = cp;
  }
  const v = final.body.validation;
  if (
    !v ||
    v.episodes !== plan.validationEpisodes ||
    !Number.isFinite(v.sum) ||
    !['terminal', 'limited', 'illegal'].every((k) => Number.isSafeInteger(v[k]) && v[k] >= 0) ||
    v.terminal + v.limited + v.illegal !== v.episodes
  )
    throw Error('invalid validation metrics in sequential checkpoint');
  return {checkpoint: final.hash, value: v.sum / v.episodes};
}

export async function extend(root, file) {
  if (fs.realpathSync(root) !== root) throw Error('use the real path of a trusted local archive');
  const {spec, source, verifyOriginal} = committedSpecification(file);
  const manifest = readRecordOrManifest(root);
  const {plan, toolchain} = manifest.body;
  contract(spec, plan);
  // No import or execution of the archived runner until its declared
  // contents are verified. As with normal resume, the archive must be trusted.
  if (toolchain.node !== process.versions.node) throw Error('use recorded Node ' + toolchain.node);
  files(path.join(root, 'code'));
  for (const name of [...Object.keys(toolchain.sources), 'backend.mjs']) {
    if (!flatSource.test(name) || !fs.lstatSync(path.join(root, 'code', name)).isFile())
      throw Error('unexpected archived code path');
  }
  checkedSnapshot(root, manifest);
  if (toolchain.sources['experiment.mjs'] !== runnerABI)
    throw Error('archived runner version is not supported for sequential stopping');
  if (typeof process.send === 'function')
    throw Error('sequential stopping must run outside an IPC child');
  const dir = path.join(root, 'sequential-validation'),
    lock = path.join(root, '.sequential-lock');
  try {
    fs.mkdirSync(lock, {mode: 0o700});
  } catch (e) {
    if (e.code === 'EEXIST')
      throw Error('sequential supervisor lock exists; verify no prior runner survives');
    throw e;
  }
  try {
    const record = path.join(dir, 'registration.json'),
      registered = fs.existsSync(record);
    if (!registered) {
      // Never register a study after seeing even one written checkpoint.
      inspectTrialPaths(root, plan, 0);
      if (fs.lstatSync(dir, {throwIfNoEntry: false}))
        throw Error('invalid pre-existing sequential directory');
      fs.mkdirSync(dir, {mode: 0o700});
      immutable(record, seal({schema: 1, run: manifest.hash, source}));
    }
    files(dir);
    const registration = readRecord(record);
    if (registration.body.schema !== 1 || registration.body.run !== manifest.hash)
      throw Error('sequential registration does not match the archive');
    verifyOriginal(registration.body.source);
    const ticket = (rep) => path.join(dir, rep + '.json');
    const entries = files(dir).filter((e) => e.name !== 'registration.json');
    if (
      entries.length > spec.maximum ||
      entries.some((e) => !e.isFile() || !/^(0|[1-9]\d*)\.json$/.test(e.name))
    )
      throw Error('invalid sequential authorization records');
    const authorized = entries.length;
    for (let rep = 0; rep < authorized; rep++) {
      const body = readRecord(ticket(rep)).body;
      if (canonical(body) !== canonical({rep, registration: registration.hash}))
        throw Error('invalid sequential authorization chain');
    }
    inspectTrialPaths(root, plan, authorized);
    let executeTrials, backend;
    const [game] = plan.games,
      rows = [],
      checkpoints = [];
    for (let rep = 0; rep < spec.maximum; rep++) {
      if (rep >= authorized) {
        inspectTrialPaths(root, plan, rep);
        immutable(ticket(rep), seal({rep, registration: registration.hash}));
      }
      const paired = {};
      for (const [armIndex, arm] of plan.arms.entries()) {
        const mayResume = rep >= authorized - 1;
        let point = readTrial(root, manifest, game, arm, rep, mayResume);
        if (!point) {
          // Trials enumerate replicate -> game -> arm. This one-game, two-arm
          // shard is precisely one arm of the prospective replicate.
          const shard = [rep * 2 + armIndex, spec.maximum * 2];
          if (!executeTrials) {
            const code = (name) => pathToFileURL(path.join(root, 'code', name)).href;
            const archived = await import(code('experiment.mjs'));
            executeTrials = archived.executeTrials;
            if (typeof executeTrials !== 'function' || executeTrials.length !== 4)
              throw Error('unexpected archived sequential runner ABI');
            backend = (await import(code('backend.mjs'))).default;
            if (!backend || typeof backend !== 'object')
              throw Error('unexpected archived backend export');
          }
          const result = await executeTrials(backend, root, manifest, {
            until: Infinity,
            shard,
            jobs: 1,
          });
          if (result?.finished !== 1 || !Number.isSafeInteger(result.created) || result.created < 1)
            throw Error('archived sequential runner did not complete the authorized shard');
          point = readTrial(root, manifest, game, arm, rep, false);
        }
        paired[arm.id] = point;
      }
      rows.push({
        replicate: rep,
        candidate: paired[spec.candidate].value,
        reference: paired[spec.reference].value,
      });
      checkpoints.push({
        replicate: rep,
        validationSeed: seedOf(plan, rep, 'validation'),
        candidate: paired[spec.candidate].checkpoint,
        reference: paired[spec.reference].checkpoint,
      });
      const evidence = sequentialPaired(rows, spec.design);
      if (
        evidence.firstAbove !== null ||
        evidence.firstBelow !== null ||
        rep + 1 === spec.maximum
      ) {
        if (authorized > rep + 1)
          throw Error('sequential authorization extends beyond the first stop');
        inspectTrialPaths(root, plan, rep + 1);
        const result = {
          run: manifest.hash,
          registration: registration.hash,
          metric: spec.metric,
          maximum: spec.maximum,
          stop:
            evidence.firstAbove !== null
              ? 'above'
              : evidence.firstBelow !== null
                ? 'below'
                : 'maximum',
          checkpoints,
          evidence,
        };
        return result;
      }
    }
  } finally {
    fs.rmdirSync(lock);
  }
}

function readRecordOrManifest(root) {
  const p = manifestPath(root);
  if (!fs.lstatSync(p).isFile()) throw Error('archive manifest must be a regular file');
  return unseal(p);
}
