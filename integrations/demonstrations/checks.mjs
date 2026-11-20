import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compilerTest} from '../../checks/support.mjs';
import {numberPreservingJson} from '../../core/finite_world.mjs';
import {loadFiniteWorld} from '../finite-session.mjs';
import {digest, encode, recorder, verify} from './recording.mjs';
import {portablePolicy} from './policy.mjs';
import {display} from './display.mjs';
import {train} from './train.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cliFile = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const bridge = path.join(root, 'worlds/bridge.json');
const run = (file, args, input, cwd) =>
  spawnSync(process.execPath, [file, ...args], {input, cwd, encoding: 'utf8', timeout: 60000});
function ok(result) {
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
}
function work(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-demonstration-test-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return (name) => path.join(dir, name);
}
function rec(world, seed, actions, limit = 2, mode = 'scripted-input') {
  const s = recorder(world, seed, limit, mode);
  for (const a of actions) s.step(a);
  return s.finish();
}
const reseal = (ep) => ({episode: ep, sha256: digest(numberPreservingJson(ep))});

test('dataset binds full normalized world identity and seed, replay-checks every public field', (t) => {
  const p = work(t),
    w = loadFiniteWorld(bridge),
    r = rec(w, 19, [7, 9]);
  assert.equal(verify(w, r).score, 3);
  assert.deepEqual(r.episode.initial, {observation: 0, legal: [0, 7], terminal: false});
  assert.deepEqual(
    r.episode.frames.map((f) => [f.action, f.reward]),
    [
      [7, 0],
      [9, 3],
    ],
  );
  for (const f of r.episode.frames) {
    assert.equal(Object.hasOwn(f, 'state'), false);
    assert.equal(Object.hasOwn(f, 'propensityBuckets'), false);
  }
  for (const change of [(e) => e.seed++, (e) => (e.inputMode = 'someone')]) {
    const changed = structuredClone(r);
    change(changed.episode);
    assert.throws(() => verify(w, changed), /checksum/);
  }
  for (const change of [
    (e) => e.frames[0].legal.reverse(),
    (e) => e.frames[1].reward++,
    (e) => e.frames.pop(),
    (e) => (e.frames[0].propensityBuckets = 65536),
    (e) => (e.initial.observation = 2),
    (e) => e.score++,
    (e) => (e.frames[1].action = 1234),
  ]) {
    const changed = structuredClone(r.episode);
    change(changed);
    assert.throws(() => verify(w, reseal(changed)), /replay mismatch|partial demonstration/);
  }
  const raw = JSON.parse(fs.readFileSync(bridge));
  raw.states[1].actions[0].outcomes[0].reward = 2;
  fs.writeFileSync(p('changed.json'), encode(raw));
  assert.throws(() => verify(loadFiniteWorld(p('changed.json')), r), /world/);
});

test('terminal at reset, terminal on last tick, truncation, illegal retry, and aliased hidden state', (t) => {
  const p = work(t);
  const raw = {
    schema: 1,
    initial: [{to: 80, weight: 1}],
    states: [
      {id: 80, observation: 4, actions: [{id: 17, outcomes: [{to: 99, weight: 1, reward: -0}]}]},
      {id: 99, observation: 4, actions: [{id: 18, outcomes: [{to: 88, weight: 1, reward: -0.25}]}]},
      {id: 88, observation: 4, actions: []},
    ],
  };
  fs.writeFileSync(p('world.json'), encode(raw));
  const w = loadFiniteWorld(p('world.json'));
  const game = recorder(w, 0xffffffff, 1, 'scripted-input');
  assert.throws(() => game.step(0), /legal/);
  assert.throws(() => game.finish(), /partial/);
  assert.equal(game.steps, 0);
  assert.equal(game.step(17).reward, -0);
  const cut = JSON.parse(encode(game.finish()));
  assert.equal(verify(w, cut).reason, 'Limit');
  assert.deepEqual(cut.episode.frames[0].nextLegal, [18]);
  assert.throws(() => game.step(18), /legal/);
  const completed = rec(w, 4, [17, 18]);
  assert.equal(completed.episode.frames[1].terminal, true);
  assert.equal(completed.episode.frames[1].truncated, false);
  for (const forbidden of ['"state":', '"to":', '"session":'])
    assert.ok(!encode(completed).includes(forbidden));
  raw.initial[0].to = 88;
  fs.writeFileSync(p('end.json'), encode(raw));
  const end = loadFiniteWorld(p('end.json'));
  assert.deepEqual(verify(end, rec(end, 0, [])).frames, []);
  assert.throws(() => recorder(w, -1, 1, 'scripted-input'), /U32/);
  assert.throws(() => recorder(w, 0, 513, 'scripted-input'), /1–512/);
});

test('CLI records deliberate actions only, no output before save; invalid actions do not advance', (t) => {
  const p = work(t),
    out = p('demo.json'),
    args = ['play', bridge, out, '--seed', '19', '--limit', '2'];
  for (const input of ['7\nquit\n', '7\n', '7\n9\n', 'save\nquit\n']) {
    assert.match(ok(run(cliFile, args, input)), /Discarded/);
    assert.equal(fs.existsSync(out), false);
  }
  const output = ok(run(cliFile, args, 'Jane-test-only\n42\n7\nreview\n9\nreview\nsave\n'));
  assert.match(output, /Accepted actions: \[7, 9\]/);
  const bytes = fs.readFileSync(out, 'utf8');
  assert.ok(!bytes.includes('Jane-test-only'));
  assert.ok(!bytes.includes(out));
  assert.equal(JSON.parse(bytes).episode.inputMode, 'scripted-input');
  assert.match(ok(run(cliFile, ['verify', bridge, out])), /Replay verified/);
  assert.match(run(cliFile, args, '0\nsave\n').stderr, /already exists/);
  assert.equal(fs.readFileSync(out, 'utf8'), bytes);
});

test('friendly driving inputs do not change episode bytes or consume a turn on help', (t) => {
  const p = work(t);
  const course = path.join(root, 'worlds/challenges/apex-kart/kart-sprint.json');
  const play = (destination, input) =>
    ok(run(cliFile, ['play', course, p(destination), '--seed', '1', '--limit', '2'], input));
  const friendly = play('words.json', 'help\nfly\nTHROTTLE\nSteer LEFT\nreview\nsave\n');
  play('numbers.json', '1\n3\nsave\n');
  assert.match(friendly, /Enter its number or name/);
  assert.match(friendly, /left hairpin after 3 straight cells/);
  assert.match(friendly, /No move recorded.*1 throttle/);
  assert.match(friendly, /Turn 1\/2 \| played 1 throttle/);
  assert.match(friendly, /Turn limit reached/);
  assert.match(friendly, /Accepted actions: \[1, 3\]/);
  assert.equal(
    fs.readFileSync(p('words.json'), 'utf8'),
    fs.readFileSync(p('numbers.json'), 'utf8'),
  );
  const gravel = play('discarded.json', 'throttle\nthrottle\nquit\n');
  assert.match(gravel, /Ran onto gravel/);
  assert.equal(fs.existsSync(p('discarded.json')), false);
});

test('failed saves preserve the completed drive, and an alternate mixed-case path can be saved', (t) => {
  const p = work(t);
  fs.writeFileSync(p('blocked'), 'not a directory');
  fs.writeFileSync(p('existing.json'), 'keep me');
  const args = ['play', bridge, p('blocked/drive.json'), '--limit', '2'];
  const recovered = p('Recovered Drive.json');
  const result = run(
    cliFile,
    args,
    '0\nsave\nsave ' + p('existing.json') + '\nreview\nSave ' + recovered + '\n',
  );
  const output = ok(result);
  assert.match(result.stderr, /Could not save/);
  assert.match(result.stderr, /Output already exists/);
  assert.match(output, /Your completed episode is still in memory/);
  assert.match(output, /Accepted actions: \[0\]/);
  assert.equal(fs.readFileSync(p('existing.json'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(p('blocked'), 'utf8'), 'not a directory');
  assert.match(ok(run(cliFile, ['verify', bridge, recovered])), /Replay verified/);
  assert.deepEqual(fs.readdirSync(p('.')).sort(), [
    'Recovered Drive.json',
    'blocked',
    'existing.json',
  ]);
  const failed = run(cliFile, args, '0\nsave\n');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /Discarded; no file written/);
});

test('display shows grid coordinates or hash-selected kart cues, never hidden state', () => {
  assert.match(
    display({grid: ['S.G']}, null, {observation: 1, legal: [1, 3]}),
    /S@G[\s\S]*1 right \| 3 left/,
  );
  const layout = {renderer: 'apex-kart', title: 'Tiny test', road: '..Lr'};
  assert.match(
    display({}, layout, {observation: 4, legal: [0, 1, 2, 3, 4]}),
    /0\/4 cells \| lane center \| speed 1\/3[\s\S]*Next track: \.\.Lr[\s\S]*left hairpin after 2 straight cells[\s\S]*4 steer right/,
  );
  assert.doesNotMatch(display({}, null, {observation: 4, legal: [3]}), /lane|steer/);
});

test(
  'Bend clone fit is deterministic, evaluation is disjoint, portable policy reproduces compiled rollouts',
  compilerTest,
  async (t) => {
    const w = loadFiniteWorld(bridge);
    const a = rec(w, 19, [7, 9]),
      b = rec(w, 20, [7, 9]);
    const f = await train(w, [a, b], 1000, 32);
    assert.deepEqual(await train(w, [b, a], 1000, 32), f);
    assert.equal(f.training.steps, 4);
    assert.equal(f.training.matches, 4);
    assert.equal(f.evaluation.untrainedMean, 1);
    assert.equal(f.evaluation.cloneMean, 2.25);
    assert.deepEqual([f.evaluation.wins, f.evaluation.ties, f.evaluation.losses], [26, 0, 6]);
    const choose = portablePolicy(w, f);
    for (const {seed, clone} of f.evaluation.paired) {
      const game = recorder(w, seed, f.limit, 'scripted-input');
      while (!game.done) game.step(choose(game.view));
      assert.equal(game.score, clone.score);
      assert.equal(game.steps, clone.steps);
    }
    assert.equal(choose({observation: 999, legal: [42, 7]}), 42);
    const p = work(t);
    fs.writeFileSync(p('a.json'), encode(a));
    const fitArgs = [
      'fit',
      bridge,
      p('fit.json'),
      p('a.json'),
      '--eval-seed',
      '1000',
      '--episodes',
      '32',
    ];
    assert.match(ok(run(cliFile, fitArgs)), /clone mean 2.25/);
    assert.match(
      ok(run(cliFile, ['watch', bridge, p('fit.json'), '--seed', '1000'])),
      /Clone played 7[\s\S]*Terminal \| 2 steps/,
    );
    const fitBytes = fs.readFileSync(p('fit.json'), 'utf8');
    assert.match(run(cliFile, fitArgs).stderr, /already exists/);
    assert.equal(fs.readFileSync(p('fit.json'), 'utf8'), fitBytes);
  },
);

test('seeds, input mode, horizons, evaluation bounds and portable legal-order ties', async () => {
  const w = loadFiniteWorld(bridge),
    a = rec(w, 0, [0]),
    b = rec(w, 1, [7, 9]);
  await assert.rejects(train(w, [a, a], 100, 1), /duplicate/);
  await assert.rejects(train(w, [a, b], 0, 1), /overlaps/);
  await assert.rejects(train(w, [a, rec(w, 2, [0], 3)], 100, 1), /different horizons/);
  // A synthetic metadata fixture is not saved or presented as a human trace.
  await assert.rejects(
    train(w, [a, rec(w, 2, [0], 2, 'interactive-terminal')], 100, 1),
    /input modes/,
  );
  await assert.rejects(train(w, [a], 0xffffffff, 2), /seed range/);
  await assert.rejects(train(w, [a], 100, 0), /seed range/);
  const fit = {
    schema: 'bend-demonstration-fit-v1',
    method: 'behavior_cloning',
    worldSha256: w.sha256,
    limit: 2,
    policy: {
      rows: [
        {
          observation: 0,
          counts: [
            {action: 0, n: 1},
            {action: 7, n: 1},
          ],
        },
      ],
    },
  };
  assert.equal(portablePolicy(w, fit)({observation: 0, legal: [7, 0]}), 7);
  assert.equal(portablePolicy(w, fit)({observation: 0, legal: [12, 0]}), 0);
  fit.policy.rows[0].counts[0].n = -1;
  assert.throws(() => portablePolicy(w, fit), /count/);
});

test(
  'recorded public frames agree with independently compiled Bend stochastic replay',
  compilerTest,
  (t) => {
    const p = work(t),
      cli = path.join(root, 'experiment.mjs');
    fs.copyFileSync(bridge, p('bridge.json'));
    fs.writeFileSync(
      p('plan.json'),
      encode({
        schema: 1,
        name: 'demo-parity',
        games: [{id: 'bridge', file: 'bridge.json', limit: 2}],
        arms: [{id: 'random', method: 'random'}],
        replicates: 1,
        checkpoints: [0],
        validationEpisodes: 8,
        testEpisodes: 0,
        seeds: {train: 1, validation: 1000, test: 3000, stride: 16},
      }),
    );
    ok(run(cli, ['run', p('plan.json'), p('run')]));
    ok(run(cli, ['verify', p('run')]));
    const w = loadFiniteWorld(bridge),
      actions = new Set();
    for (let i = 0; i < 8; i++) {
      const replay = JSON.parse(
        ok(run(cli, ['replay', p('run'), 'bridge', 'random', '0', '0', 'validation', String(i)])),
      );
      const record = rec(
        w,
        replay.seed,
        replay.frames.map((f) => f.action),
      );
      assert.deepEqual(verify(w, record).frames, replay.frames);
      assert.equal(record.episode.score, replay.score);
      actions.add(replay.frames[0].action);
    }
    assert.deepEqual([...actions].sort(), [0, 7]);
  },
);

test(
  'learner-state corrections are off-trajectory labels, not applied actions or counterfactual rewards',
  compilerTest,
  async (t) => {
    const p = work(t),
      w = loadFiniteWorld(bridge),
      demo = rec(w, 1, [0]);
    const first = await train(w, [demo], 300, 1);
    const files = {};
    fs.writeFileSync(p('fit.json'), encode(first));
    for (const [seed, label] of [
      [2, '7'],
      [3, '7'],
      [4, 'skip'],
      [5, 'same'],
    ]) {
      const out = p('label-' + seed + '.json');
      const cli = ['label', bridge, p('fit.json'), out, '--seed', String(seed)];
      if (seed === 2) {
        assert.match(ok(run(cliFile, cli, '7\nquit\n')), /Discarded/);
        assert.equal(fs.existsSync(out), false);
      }
      const coaching = ok(run(cliFile, cli, '99\n' + label + '\nreview\nsave\n'));
      assert.match(coaching, /Clone will play 0/);
      assert.match(coaching, /No label or turn recorded/);
      const expected = label === 'skip' ? 'skipped' : label === 'same' ? '0' : '7';
      assert.ok(coaching.includes('clone played 0 | your label: ' + expected));

      const record = JSON.parse(fs.readFileSync(out));
      const ep = verify(w, record);
      assert.equal(ep.frames.length, 1);
      assert.equal(ep.frames[0].action, 0);
      assert.equal(ep.score, 1);
      assert.deepEqual(ep.annotations[0], {
        proposedAction: 0,
        appliedAction: 0,
        teacherLabel: label === 'skip' ? null : label === 'same' ? 0 : 7,
      });
      if (label !== 'same') files[seed] = record;
    }
    await assert.rejects(train(w, [files[2]], 1000, 32), /original training/);
    const editedFit = structuredClone(first);
    editedFit.policy.rows[0].counts[0].n++;
    const unrelated = recorder(w, 5, first.limit, 'scripted-input', editedFit);
    unrelated.step(7);
    // Its recorded rollout is valid, but the declared parents did not produce this frequency table.
    assert.equal(verify(w, unrelated.finish()).frames[0].action, 0);
    await assert.rejects(
      train(w, [demo, unrelated.finish()], 1000, 1),
      /referenced training labels/,
    );
    const fit = await train(w, [demo, ...Object.values(files)], 1000, 32);
    assert.equal(fit.training.steps, 4);
    assert.equal(fit.training.labels, 3);
    assert.equal(fit.training.learnerStateLabels, 2);
    assert.equal(fit.training.disagreements, 2);
    assert.equal(fit.training.matches, 2);
    assert.equal(fit.evaluation.cloneMean, 2.25);
    for (const change of [
      (ep) => (ep.annotations[0].proposedAction = 7),
      (ep) => (ep.annotations[0].appliedAction = 7),
      (ep) => (ep.annotations[0].teacherLabel = 9),
      (ep) => (ep.controllerSha256 = 'a'.repeat(64)),
      (ep) => (ep.controller.policy.rows[0].counts[0].action = 7),
    ]) {
      const changed = structuredClone(files[2].episode);
      change(changed);
      assert.throws(() => verify(w, reseal(changed)), /replay mismatch|legal|partial/);
    }
    assert.throws(() => recorder(w, 1, 2, 'scripted-input', first), /fresh collection seed/);
  },
);

test(
  'the equal-budget scripted kart experiment reproduces its checked-in summary',
  compilerTest,
  (t) => {
    const p = work(t);
    ok(run(fileURLToPath(new URL('./kart-study.mjs', import.meta.url)), [p('study')]));
    assert.equal(
      fs.readFileSync(p('study/summary.json'), 'utf8'),
      fs.readFileSync(new URL('./kart-result.json', import.meta.url), 'utf8'),
    );
  },
);
