import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readPlan, run, seal} from '../core/experiment.mjs';
import {canonical, digest} from '../core/experiment_config.mjs';
import {execute} from '../core/process_output.mjs';
import {compilerTest} from './support.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
test(
  'committed validation-only extension stops before starting the next replicate',
  {...compilerTest, timeout: 60_000},
  async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-sequential-test-'));
    t.after(() => fs.rmSync(home, {recursive: true, force: true}));
    const local = (name) => path.join(home, name);
    const archive = local('archive'),
      foreign = local('foreign'),
      source = local('checkout'),
      undecided = local('undecided'),
      zero = local('zero-validation'),
      resumed = local('resume-last'),
      unsupported = local('unsupported');
    const action = {id: 0, outcomes: [{to: 1, reward: 1, weight: 1}]};
    const plan = {
      schema: 1,
      name: 'prospective',
      games: [
        {
          id: 'tiny',
          limit: 1,
          definition: {
            schema: 1,
            initial: [{to: 0, weight: 1}],
            states: [
              {id: 0, actions: [action]},
              {id: 1, actions: []},
            ],
          },
        },
      ],
      arms: [
        {id: 'q', method: 'q_learning'},
        {id: 'dyna', method: 'dyna_q'},
      ],
      replicates: 3,
      checkpoints: [0, 1],
      validationEpisodes: 1,
      testEpisodes: 0,
      seeds: {train: 10, validation: 100, test: 200, stride: 10},
    };
    // Initialize a sealed archive with a shard selecting zero trials.
    await run(plan, archive, ['--shard', '6/7']);
    fs.cpSync(archive, foreign, {recursive: true});
    fs.cpSync(archive, undecided, {recursive: true});
    fs.cpSync(archive, zero, {recursive: true});
    fs.cpSync(archive, resumed, {recursive: true});
    fs.cpSync(archive, unsupported, {recursive: true});
    const unsupportedRunner = path.join(unsupported, 'code/experiment.mjs');
    fs.appendFileSync(unsupportedRunner, '\n// unsupported runner revision fixture\n');
    const unsupportedManifest = path.join(unsupported, 'run.json');
    const unsupportedBody = JSON.parse(fs.readFileSync(unsupportedManifest, 'utf8')).body;
    unsupportedBody.toolchain.sources['experiment.mjs'] = digest(
      fs.readFileSync(unsupportedRunner),
    );
    fs.writeFileSync(unsupportedManifest, seal(unsupportedBody));
    const zeroManifest = path.join(zero, 'run.json');
    const zeroBody = JSON.parse(fs.readFileSync(zeroManifest, 'utf8')).body;
    zeroBody.plan.validationEpisodes = 0;
    fs.writeFileSync(zeroManifest, seal(zeroBody));
    // Give the test its own Git history. The checkout under test stays unchanged.
    for (const folder of ['core', 'analysis'])
      fs.mkdirSync(path.join(source, folder), {recursive: true});
    for (const name of fs.readdirSync(path.join(repo, 'core')).filter((n) => n.endsWith('.mjs')))
      fs.copyFileSync(path.join(repo, 'core', name), path.join(source, 'core', name));
    for (const name of ['extend.mjs', 'sequential.mjs'])
      fs.copyFileSync(path.join(repo, 'analysis', name), path.join(source, 'analysis', name));
    const specFile = path.join(source, 'spec.json');
    const spec = {
      schema: 1,
      planSha256: digest(canonical(readPlan(plan))),
      game: 'tiny',
      candidate: 'q',
      reference: 'dyna',
      metric: 'validation_return',
      checkpoint: 1,
      maximum: 3,
      design: {lower: -1, upper: 1, margin: 1, alpha: 0.05},
    };
    const zeroSpec = path.join(source, 'zero-spec.json');
    const noStopSpec = path.join(source, 'no-stop-spec.json');
    fs.writeFileSync(specFile, JSON.stringify(spec));
    fs.writeFileSync(noStopSpec, JSON.stringify({...spec, design: {...spec.design, margin: 0}}));
    fs.writeFileSync(
      zeroSpec,
      JSON.stringify({...spec, planSha256: digest(canonical(zeroBody.plan))}),
    );
    const git = (...args) => execFileSync('git', ['-C', source, ...args], {stdio: 'pipe'});
    git('init', '-q');
    git('add', 'spec.json', 'zero-spec.json', 'no-stop-spec.json');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'Preregister validation plan',
    );
    const api = pathToFileURL(path.join(source, 'analysis/extend.mjs')).href;
    const invoke = (root, selectedSpec = specFile) =>
      execute(process.execPath, [
        '--input-type=module',
        '-e',
        'const {extend}=await import(process.argv[1]); console.log(JSON.stringify(await extend(process.argv[2],process.argv[3])))',
        api,
        root,
        selectedSpec,
      ]);
    const executed = JSON.parse((await invoke(archive)).stdout);
    assert.equal(executed.stop, 'below');
    assert.equal(executed.evidence.firstBelow, 1);
    assert.equal(executed.checkpoints.length, 1);
    for (const arm of ['q', 'dyna'])
      assert.deepEqual(fs.readdirSync(path.join(archive, 'trials/tiny', arm)), ['0']);
    assert.equal(JSON.parse((await invoke(archive)).stdout).registration, executed.registration);
    assert.equal(fs.existsSync(path.join(archive, '.sequential-lock')), false);

    // Simulate a controlled stop after the first authorized arm saved an
    // initial checkpoint. Preserve those exact bytes on optimized resume.
    fs.cpSync(
      path.join(archive, 'sequential-validation'),
      path.join(resumed, 'sequential-validation'),
      {recursive: true},
    );
    await execute(process.execPath, [
      path.join(resumed, 'code/experiment.mjs'),
      'resume',
      resumed,
      '--shard',
      '0/6',
      '--until',
      '0',
    ]);
    const partial = path.join(resumed, 'trials/tiny/q/0/0.json');
    const initialBytes = fs.readFileSync(partial);
    assert.deepEqual(JSON.parse((await invoke(resumed)).stdout), executed);
    assert.deepEqual(fs.readFileSync(partial), initialBytes);
    for (const arm of ['q', 'dyna'])
      for (const n of [0, 1]) {
        const sub = path.join('trials', 'tiny', arm, '0', n + '.json');
        assert.deepEqual(
          fs.readFileSync(path.join(resumed, sub)),
          fs.readFileSync(path.join(archive, sub)),
        );
      }
    await assert.rejects(invoke(unsupported), /archived runner version is not supported/);
    assert.equal(fs.existsSync(path.join(unsupported, 'sequential-validation')), false);

    const maximum = JSON.parse((await invoke(undecided, noStopSpec)).stdout);
    assert.equal(maximum.stop, 'maximum');
    assert.equal(maximum.checkpoints.length, 3);
    assert.equal(maximum.evidence.firstAbove, null);
    assert.equal(maximum.evidence.firstBelow, null);
    await assert.rejects(invoke(zero, zeroSpec), /requires at least one validation episode/);
    assert.equal(fs.existsSync(path.join(zero, 'sequential-validation')), false);
    assert.equal(fs.existsSync(path.join(zero, 'trials')), false);

    const pathToFuture = path.join(archive, 'trials/tiny/q/1');
    fs.mkdirSync(pathToFuture);
    fs.writeFileSync(path.join(pathToFuture, '0.json'), 'this future body must not be parsed');
    await assert.rejects(invoke(archive), /beyond the authorized sequential prefix/);
    fs.mkdirSync(path.join(foreign, 'trials/tiny/q/0'), {recursive: true});
    fs.writeFileSync(
      path.join(foreign, 'trials/tiny/q/0/0.json'),
      'this prior body must not be parsed',
    );
    await assert.rejects(invoke(foreign), /beyond the authorized sequential prefix/);
    fs.appendFileSync(specFile, '\n');
    await assert.rejects(invoke(archive), /must match the bytes committed/);
  },
);
