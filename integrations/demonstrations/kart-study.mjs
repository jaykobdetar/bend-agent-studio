// Reproducible synthetic comparison: no real person, no browser and no training on evaluation frames.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {worldDefinition} from '../../core/finite_world.mjs';
import {courses, decode} from '../../worlds/challenges/apex-kart/kart.mjs';
import {scriptedInput} from '../../worlds/challenges/apex-kart/driver.mjs';
import {loadFiniteWorld} from '../finite-session.mjs';
import {encode, recorder, verify} from './recording.mjs';
import {portablePolicy} from './policy.mjs';
import {train} from './train.mjs';

const file = fileURLToPath(
  new URL('../../worlds/challenges/apex-kart/kart-ridge.json', import.meta.url),
);
const {road} = courses['kart-ridge'];
const limit = 32,
  first = 1000,
  episodes = 64;
const out = process.argv[2];
if (!out || process.argv.length !== 3)
  throw Error('usage: node integrations/demonstrations/kart-study.mjs NEW_DIRECTORY');
const world = loadFiniteWorld(file),
  definition = worldDefinition(JSON.parse(fs.readFileSync(file)));
assert.equal(definition.initial.length, 2);
assert.equal(definition.initial[0].weight, definition.initial[1].weight);
assert.ok(definition.states.every((s) => s.actions.every((a) => a.outcomes.length === 1)));
function laneSeed(lane, start) {
  for (let s = start; s < start + 64; s++)
    if (decode(world.start(s, limit).initial.observation).lane === lane) return s;
  throw Error('no matching reset lane');
}
function collect(seed, controller = null, budget = Infinity) {
  const s = recorder(world, seed, limit, 'scripted-input', controller);
  while (!s.done) s.step(s.steps < budget ? scriptedInput(road, s.view.observation) : null);
  const record = s.finish();
  verify(world, record);
  return record;
}
const seedL = laneSeed(0, 1),
  seedR = laneSeed(2, 1);
const left = collect(seedL),
  right = collect(seedR);
const initial = await train(world, [left], 3000, 1); // pilot seed never used for final evaluation
const correction = collect(seedR, initial, right.episode.frames.length);
const paid = correction.episode.annotations.filter((a) => a.teacherLabel !== null);
assert.equal(paid.length, right.episode.frames.length, 'must match teacher-label budgets');
const sets = {initial: [left], demonstrations: [left, right], learnerLabels: [left, correction]};
const report = {
  schema: 'bend-scripted-kart-label-comparison-v1',
  inputMode: 'scripted-input',
  worldSha256: world.sha256,
  training: {
    seedL,
    seedR,
    initialLabels: left.episode.frames.length,
    extraLabelsPerArm: paid.length,
    learnerDrivenTicks: correction.episode.frames.length,
    differencesFromDriver: paid.filter((a) => a.teacherLabel !== a.appliedAction).length,
  },
  evaluation: {firstSeed: first, episodes, distinctResetLanes: 2},
  policies: {},
};
const writes = {'left.json': left, 'right-teacher.json': right, 'right-learner.json': correction};
const heldout = [laneSeed(0, first), laneSeed(2, first)];
for (const [name, records] of Object.entries(sets)) {
  const fit = await train(world, records, first, episodes);
  writes[name + '-fit.json'] = fit;
  const choose = portablePolicy(world, fit);
  function rollout(seed, forced) {
    const s = recorder(world, seed, limit, 'scripted-input');
    while (!s.done) s.step(s.steps === 1 && forced !== null ? forced : choose(s.view));
    return s.score;
  }
  for (const pair of fit.evaluation.paired)
    assert.equal(pair.clone.score, rollout(pair.seed, null));
  const normal = heldout.map((s) => rollout(s, null));
  const forced = heldout.flatMap((s) => [0, 1, 2, 3, 4].map((a) => rollout(s, a)));
  report.policies[name] = {
    labels: fit.training.labels,
    observations: fit.training.observations,
    left: normal[0],
    right: normal[1],
    unsupportedStepsNormalLeftRight: heldout.map(
      (seed) => fit.evaluation.paired.find((row) => row.seed === seed).clone.unsupported,
    ),
    equalLaneMean: (normal[0] + normal[1]) / 2,
    paired64Mean: fit.evaluation.cloneMean,
    forcedSecondActionReturns: {left: forced.slice(0, 5), right: forced.slice(5)},
    forcedSecondActionMean: forced.reduce((sum, n) => sum + n, 0) / forced.length,
  };
}
writes['summary.json'] = report;
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.mkdirSync(out); // Never overwrite or combine evidence directories.
for (const [name, data] of Object.entries(writes))
  fs.writeFileSync(path.join(out, name), encode(data), {flag: 'wx', mode: 0o600});
console.log(encode(report));
