import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {compilerTest} from './support.mjs';
import {seal} from '../core/experiment.mjs';

const cli = fileURLToPath(new URL('../experiment.mjs', import.meta.url));
function workspace(t) {
  const temp = path.parse(cli).root.toLowerCase() === path.parse(os.tmpdir()).root.toLowerCase()
    ? os.tmpdir() : path.dirname(cli);
  const cwd = fs.mkdtempSync(path.join(temp, 'bend-scaffold-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const run = (exe, ...args) => execFileSync(exe, args, {cwd, encoding: 'utf8', stdio: 'pipe', timeout: 30000});
  return {
    cwd, run, node: (...args) => run(process.execPath, cli, ...args),
    put: (file, data) => fs.writeFileSync(path.join(cwd, file), JSON.stringify(data)),
    get: file => fs.readFileSync(path.join(cwd, file), 'utf8'),
  };
}

test('scaffolds validate, refuse existing outputs and accept only safe lower-case names', t => {
  const {node, get} = workspace(t);
  assert.match(node('init', 'plan', 'example'), /example.json/);
  assert.match(node('validate', 'experiments/example.json'), /1 trials/);
  assert.match(node('init', 'world', 'one_step'), /one_step.json/);
  assert.match(node('init', 'world', 'one_step', '--bend'), /one_step.bend/);
  assert.match(node('init', 'agent', 'placeholder'), /proof.bend/);
  assert.match(node('validate', 'agents/placeholder/example.json'), /placeholder: Hooks/);
  const original = get('experiments/example.json');
  assert.throws(() => node('init', 'plan', 'example'), /EEXIST/);
  assert.equal(get('experiments/example.json'), original);
  assert.throws(() => node('init', 'agent', 'placeholder'), /EEXIST/);
  for (const unsafe of ['..', '../name', 'AUpper', 'con', 'x/y', 'x\\y'])
    assert.throws(() => node('init', 'world', unsafe), /portable identifier/);
  assert.throws(() => node('init', 'plan', 'no', '--bend'), /world only/);
});

function sweepFixture(w) {
  const source = JSON.parse(w.get('experiments/example.json'));
  source.arms[0] = {id: 'q', method: 'q_learning'};
  w.put('experiments/example.json', source);
  return {schema: 1, plan: 'experiments/example.json', arm: 'q',
    grid: {epsilon: [0.125, 0.25, 0.5], alpha: [0.125, 0.25, 0.5]}};
}

test('grid and seeded random sweeps give unique normalized arms, preserving matched seed blocks', t => {
  const w = workspace(t), {node, put, get} = w;
  node('init', 'plan', 'example');
  const spec = sweepFixture(w);
  put('spec.json', spec);
  node('sweep', 'spec.json', 'all.json');
  const all = JSON.parse(get('all.json'));
  assert.equal(all.arms.length, 9);
  assert.equal(new Set(all.arms.map(a => a.id)).size, 9);
  assert.equal(all.testEpisodes, 0);
  assert.deepEqual(all.seeds, JSON.parse(get('experiments/example.json')).seeds);
  assert.match(node('validate', 'all.json'), /9 trials/);
  assert.throws(() => node('sweep', 'spec.json', 'all.json'), /EEXIST/);
  put('spec.json', {...spec, random: {seed: 248, count: 4}});
  node('sweep', 'spec.json', 'sample.json');
  node('sweep', 'spec.json', 'repeat.json');
  assert.equal(get('sample.json'), get('repeat.json'));
  assert.equal(JSON.parse(get('sample.json')).arms.length, 4);
  put('spec.json', {...spec, grid: {alpha: [0.25, 0.2500000001]}});
  assert.throws(() => node('sweep', 'spec.json', 'bad.json'), /duplicate runner settings/);
  put('spec.json', {...spec, grid: {epsilon: [0, 0.0000001]}});
  assert.throws(() => node('sweep', 'spec.json', 'bad.json'), /duplicate runner settings/);
  put('spec.json', {...spec, grid: {alpha: [0.25, 1.5]}});
  assert.throws(() => node('sweep', 'spec.json', 'bad.json'), /alpha must be a number/);
  const broken = JSON.parse(get('experiments/example.json'));
  broken.seeds.validation = broken.seeds.train;
  put('experiments/example.json', broken);
  put('spec.json', spec);
  assert.throws(() => node('sweep', 'spec.json', 'bad.json'), /overlap/);
  assert.throws(() => get('bad.json'), /ENOENT/);
});

test('scaffolded Bend sources compile and the agent, Bend world and sweep execute', compilerTest, t => {
  const w = workspace(t), {run, node, get, put} = w;
  const bend = process.env.BEND ?? 'bend';
  node('init', 'agent', 'starter');
  node('init', 'world', 'starter', '--bend');
  node('init', 'plan', 'example');
  assert.match(run(bend, 'agents/starter/checks.bend'), /pass - chooses the first legal action/);
  run(bend, 'worlds/starter.bend', '--check-only');
  if (process.env.BEND_CHECK_SCAFFOLD_VERDICT === '1')
    assert.match(run(bend, 'agents/starter/proof.bend', '--verdict'), /ALL PROOFS CHECK/);
  node('run', 'agents/starter/example.json', 'agent-run');
  node('verify', 'agent-run');
  put('spec.json', sweepFixture(w));
  node('sweep', 'spec.json', 'screen.json');
  const screen = JSON.parse(get('screen.json'));
  screen.games = [{id: 'starter', limit: 1, worldFile: 'worlds/starter.bend', domain: 'discrete'}];
  put('screen.json', screen);
  node('run', 'screen.json', 'screening-run');
  assert.equal(JSON.parse(node('verify', 'screening-run')).completeTrials, 9);
  const header = node('export', 'screening-run').split(/\r?\n/)[0].split(',');
  const first = node('export', 'screening-run').split(/\r?\n/)[1].split(',');
  assert.equal(first[header.indexOf('test_episodes')], '');
});

test('successive halving advances only survivors and rejects any test-bearing checkpoint',
  compilerTest, t => {
    const w = workspace(t), {node, get, put} = w;
    node('init', 'plan', 'base');
    const base = JSON.parse(get('experiments/base.json'));
    base.arms = [{id: 'q', method: 'q_learning'}];
    base.checkpoints = [0, 2, 4];
    put('experiments/base.json', base);
    const spec = {schema: 1, plan: 'experiments/base.json', arm: 'q',
      grid: {alpha: [0.125, 0.25, 0.5, 1]}, halving: {factor: 2, checkpoints: [2, 4]}};
    put('spec.json', spec);
    node('sweep', 'spec.json', 'screen.json');
    assert.throws(() => {
      put('bad-rungs.json', {...spec, halving: {checkpoints: [1, 4]}});
      node('sweep', 'bad-rungs.json', 'bad.json');
    }, /existing checkpoints/);
    // Stage one is intentionally incomplete: the planner must request missing
    // shards, not infer a winner from the available subset.
    node('run', 'screen.json', 'screen', '--until', '2', '--shard', '0/4');
    node('sweep', 'spec.json', 'partial.json', '--halving', 'screen');
    const partial = JSON.parse(get('partial.json'));
    assert.equal(partial.stages.length, 0);
    assert.deepEqual(partial.next.map(x => x.shard), ['1/4', '2/4', '3/4']);
    for (const row of partial.next)
      node('resume', 'screen', '--until', String(row.until), '--shard', row.shard);

    node('sweep', 'spec.json', 'rung.json', '--halving', 'screen');
    const rung = JSON.parse(get('rung.json'));
    assert.deepEqual(rung.stages[0].survivors, ['sweep_001', 'sweep_002']);
    assert.deepEqual(rung.next.map(x => x.shard), ['0/4', '1/4']);
    for (const row of rung.next)
      node('resume', 'screen', '--until', String(row.until), '--shard', row.shard);
    node('sweep', 'spec.json', 'final.json', '--halving', 'screen');
    const final = JSON.parse(get('final.json'));
    assert.equal(final.winner, 'sweep_001');
    assert.deepEqual(final.next, []);
    assert.throws(() => get('screen/trials/one_step/sweep_003/0/4.json'), /ENOENT/);
    const file = 'screen/trials/one_step/sweep_001/0/4.json';
    const row = JSON.parse(get(file)).body;
    row.test = {...row.validation, sum: 999};
    fs.writeFileSync(path.join(w.cwd, file), seal(row));
    assert.throws(() => node('sweep', 'spec.json', 'leak.json', '--halving', 'screen'),
      /expected validation-only data/);
    assert.throws(() => get('leak.json'), /ENOENT/);
  },
);
