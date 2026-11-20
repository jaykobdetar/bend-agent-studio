// Narrow scalar study only; no production runner entry and no native sealing.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buckets, numberPreservingJson, worldDefinition} from '../../core/finite_world.mjs';
import {canonical, digest, settings, validate} from '../../core/experiment_config.mjs';
import {checkedSnapshot, manifestPath, readPlan, record, seal, stats, status, unseal} from '../../core/experiment.mjs';

const fixtureArms = {q_learning: 'q', expected_sarsa: 'expected', double_q: 'double', random: 'uniform', dyna_q: 'dyna'};
const methods = Object.keys(fixtureArms);
const U32_MAX = 0xffffffff;
const bytes = new DataView(new ArrayBuffer(4));
const bits = value => (bytes.setFloat32(0, value), bytes.getUint32(0));
const float = word => (bytes.setUint32(0, word), bytes.getFloat32(0));
const output = (pathname, text) => fs.writeFileSync(pathname, text, {flag: 'wx'});
const own = fileURLToPath(new URL('.', import.meta.url));

function fixture(packed, method) {
  const definition = {
    schema: 1,
    initial: [{to: 17, weight: 7}, {to: 0xfffffffe, weight: 3}, {to: 900, weight: 2}],
    states: [
      {id: 17, observation: 0x80000003, actions: [
        {id: U32_MAX, outcomes: [{to: 0xfffffffe, weight: 2, reward: -0}, {to: 900, weight: 3, reward: 1 / 3}]},
        {id: 0, outcomes: [{to: 17, weight: 1, reward: -0.125}]},
        {id: 3, outcomes: [{to: 0x80000000, weight: 1, reward: 0.125}]},
      ]},
      {id: 0xfffffffe, observation: 0x80000003, actions: [
        {id: 3, outcomes: [{to: 900, weight: 2 ** 32 - 1, reward: 0}, {to: 17, weight: 1, reward: -2}]},
        {id: U32_MAX, outcomes: [{to: 17, weight: 1, reward: -0.25}]},
      ]},
      {id: 0x80000000, observation: 3, actions: [
        {id: 7, outcomes: [{to: 0x80000000, weight: 1, reward: 0.25}, {to: 900, weight: 2, reward: -0.15}]},
        {id: 3, outcomes: [{to: 0xfffffffe, weight: 1, reward: -0.125}]},
      ]},
      {id: 900, actions: []},
    ],
  };
  if (method === 'dyna_q') {
    // One source pair can reach equal public views from distinct physical
    // rows, an order-only legal-list difference, and Open versus End.
    const observation = 0x80000003;
    const aliasActions = definition.states[1].actions;
    definition.states.push(
      {id: 42, observation, actions: [...aliasActions].reverse()},
      {id: 43, observation, actions: aliasActions},
      {id: 44, observation, actions: []},
    );
    definition.states[0].actions[0].outcomes = [
      {to: 0xfffffffe, weight: 2, reward: -0},
      {to: 42, weight: 2, reward: 1 / 3},
      {to: 43, weight: 2, reward: -0.15},
      {to: 44, weight: 2, reward: 0.125},
      {to: 900, weight: 2, reward: -0.25},
    ];
  }
  if (packed) for (let i = 1000; definition.states.length < 128; ++i) definition.states.push({id: i, actions: []});
  return {
    schema: 1,
    name: (packed ? 'p118-packed' : 'p118-literal') + (method === 'q_learning' ? '' : '-' + fixtureArms[method]),
    games: [{id: 'wire', definition, limit: 3}],
    arms: [{id: fixtureArms[method], method, alpha: 0.375, gamma: 0.875, epsilon: 0.25,
      ...(method === 'dyna_q' ? {planningSteps: 5} : {})}],
    replicates: 3, checkpoints: [0, 1, 7, 31],
    validationEpisodes: 16, testEpisodes: 24,
    seeds: {train: 3188627573, validation: 1024, test: 4294967030, stride: 80},
  };
}

function exactFields(input, keys, where) {
  assert(input && typeof input === 'object' && !Array.isArray(input), where + ': expected object');
  assert.deepEqual(Object.keys(input).sort(), [...keys].sort(), where + ': unsupported or missing fields');
}
function requireEligible(plan) {
  assert.equal(plan.budgetUnit, 'episodes', 'only whole-episode budgets are supported');
  assert.equal(plan.evaluationGames, undefined, 'additional evaluation worlds are unsupported');
  exactFields(plan, ['schema', 'name', 'games', 'arms', 'replicates', 'checkpoints', 'budgetUnit',
    'maxTrainEpisodes', 'validationEpisodes', 'testEpisodes', 'seeds'], 'normalized plan');
  assert.equal(plan.games.length, 1, 'requires one finite JSON world');
  assert.equal(plan.arms.length, 1, 'requires one built-in arm');
  const [game] = plan.games, [arm] = plan.arms;
  assert.ok(game.definition && !game.world, 'requires a finite JSON definition');
  exactFields(game, ['id', 'limit', 'definition'], 'normalized game');
  assert.ok(methods.includes(arm.method), 'only built-in Q-learning, Expected SARSA, Double Q, Uniform and Dyna-Q are supported');
  assert.equal(arm.observation, 'current', 'previous-observation encoding is unsupported');
  const dynaFields = arm.method === 'dyna_q' ? ['planningSteps'] : [];
  exactFields(arm, ['id', 'method', 'observation', 'epsilon', 'alpha', 'gamma', 'buckets', ...dynaFields], 'normalized arm');
  if (arm.method === 'dyna_q') assert.ok(arm.planningSteps <= 25, 'scalar fixture limit: at most 25 planning steps per move');
  assert.ok(plan.replicates <= 8 && plan.checkpoints.length <= 16 && plan.checkpoints.at(-1) <= 4096,
    'scalar fixture limit: 8 replicates, 16 checkpoints, 4096 episodes');
  assert.ok(game.limit <= 128 && plan.validationEpisodes <= 128 && plan.testEpisodes <= 128,
    'scalar fixture limit: horizon and evaluation counts at most 128');
  assert.ok(game.definition.states.length <= 512, 'scalar fixture limit: at most 512 physical states');
  assert.deepEqual(game.definition, worldDefinition(game.definition));
  const {buckets: _, ...rawArm} = arm;
  assert.deepEqual(plan, validate({...plan, arms: [rawArm]}), 'plan is not the exact stock normalization');
}

function generated(plan) {
  requireEligible(plan);
  const w = plan.games[0].definition, arm = plan.arms[0], cols = [], states = [], outs = [];
  const fileIds = new Map(w.states.map((s, i) => [s.id, i]));
  const add = (xs) => {
    const start = outs.length;
    for (const p of buckets(xs)) outs.push([p.upper, fileIds.get(p.to), bits(p.reward ?? 0)]);
    return [start, xs.length];
  };
  const [INITIAL_BASE, INITIAL_COUNT] = add(w.initial);
  const pairs = new Set();
  for (const s of w.states) {
    states.push([s.observation, cols.length, s.actions.length]);
    for (const a of s.actions) {
      pairs.add(s.observation + '/' + a.id);
      cols.push([a.id, ...add(a.outcomes)]);
    }
  }
  assert.ok(cols.length <= 8192 && outs.length <= 16384 && pairs.size <= 4096,
    'scalar fixture limit: 8192 action rows, 16384 outcomes, 4096 public observation/action pairs');
  const constants = {
    INITIAL_BASE, INITIAL_COUNT, PAIR_CAP: Math.max(1, pairs.size),
    STEP_LIMIT: plan.games[0].limit, REPLICATES: plan.replicates,
    ALPHA_BITS: bits(arm.alpha), GAMMA_BITS: bits(arm.gamma), EXPLORATION: arm.buckets,
    EXPECTED_SARSA: Number(arm.method === 'expected_sarsa'),
    DOUBLE_Q: Number(arm.method === 'double_q'), UNIFORM: Number(arm.method === 'random'),
    DYNA_Q: Number(arm.method === 'dyna_q'), PLANNING_STEPS: arm.planningSteps ?? 0,
    SAMPLE_CAP: Math.max(1, outs.length - INITIAL_COUNT),
    TRAIN_SEED: plan.seeds.train, VAL_SEED: plan.seeds.validation, TEST_SEED: plan.seeds.test,
    STRIDE: plan.seeds.stride, VAL_COUNT: plan.validationEpisodes, TEST_COUNT: plan.testEpisodes,
  };
  const u = n => {assert.ok(Number.isInteger(n) && n >= 0 && n <= U32_MAX); return n + 'u';};
  const table = (type, name, rows) =>
    'static const ' + type + ' ' + name + '[] = {\n' +
    (rows.length ? rows : [[0,0,0]]).map(row => '  {' + row.map(u).join(', ') + '}').join(',\n') + '\n};';
  return Object.entries(constants).map(([k,v]) => '#define ' + k + ' ' + u(v)).concat(
    table('Outcome', 'outcomes', outs), table('Action', 'actions', cols), table('State', 'states', states),
    'static const uint32_t checkpoints[] = {' + plan.checkpoints.map(u).join(', ') + '};',
    '#define PLAN_HASH ' + JSON.stringify(digest(canonical(plan))),
  ).join('\n');
}

function table(cells) {
  assert.ok(Array.isArray(cells) && cells.length <= 4096, 'invalid tree wire');
  const seen = new Set();
  function visit(i, depth = 0) {
    if (i === U32_MAX) return {$: 'Vacant'};
    assert.ok(Number.isInteger(i) && i >= 0 && i < cells.length && depth <= 64 && !seen.has(i));
    seen.add(i);
    const row = cells[i];
    assert.ok(Array.isArray(row) && row.length === 6 &&
      row.every(n => Number.isInteger(n) && n >= 0 && n <= U32_MAX));
    const [s,a,visits,value,lo,hi] = row;
    return {$: 'Node', s, a, cell: {$: 'Cell', visits, value: float(value)},
      lo: visit(lo, depth+1), hi: visit(hi, depth+1)};
  }
  const tree = cells.length ? visit(0) : null;
  assert.equal(seen.size, cells.length);
  return tree ? {$: 'Con', head: {$: 'Indexed', tree}, tail: {$: 'Nil'}} : {$: 'Nil'};
}
const u32 = n => Number.isInteger(n) && n >= 0 && n <= U32_MAX;
function bendList(rows, map) {
  let list = {$: 'Nil'};
  for (let i = rows.length - 1; i >= 0; --i) list = {$: 'Con', head: map(rows[i]), tail: list};
  return list;
}
function dynaModel(wire, config, world) {
  assert.ok(Array.isArray(wire) && wire.length === 4, 'invalid planning model wire');
  const [values, pairs, size, seed] = wire;
  assert.ok(u32(seed) && Array.isArray(pairs) && pairs.length === size && size <= 4096);
  let samples = 0;
  const experience = bendList(pairs, entry => {
    assert.ok(Array.isArray(entry) && entry.length === 4);
    const [obs, action, total, outcomes] = entry;
    assert.ok([obs, action, total].every(u32) && Array.isArray(outcomes) && outcomes.length > 0);
    assert.ok((samples += outcomes.length) <= 16384);
    let moves = 0;
    const encoded = bendList(outcomes, sample => {
      assert.ok(Array.isArray(sample) && sample.length === 3 && sample.every(u32));
      const [row, count, reward] = sample;
      assert.ok(row < world.states.length && count > 0);
      moves += count;
      const {observation, actions} = world.states[row];
      const next = actions.length
        ? {$: 'Open', observation, actions: bendList(actions, a => a.id)}
        : {$: 'End', observation};
      return {$: 'Sample', next, count, reward: float(reward)};
    });
    assert.equal(moves, total);
    return {$: 'PairModel', obs, action, total, outcomes: encoded};
  });
  return {$: 'PlanningAgent', settings: config, state: {$: 'Planner', values: table(values), experience, pairs: size, seed}};
}
function model(wire, config, world) {
  if (config.method.$ === 'DynaQ') return dynaModel(wire, config, world);
  if (config.method.$ === 'DoubleQ') {
    assert.ok(Array.isArray(wire) && wire.length === 3, 'invalid double model wire');
    const [left,right,seed] = wire;
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= U32_MAX, 'invalid update stream seed');
    return {$: 'DoubleAgent', settings: config, tables: {$: 'Tables', left: table(left), right: table(right), seed}};
  }
  if (config.method.$ === 'Uniform') assert.deepEqual(wire, [], 'uniform model must not learn');
  return {$: 'Agent', settings: config, values: table(wire)};
}
function accumulate(sum, reports, expected) {
  assert.ok(Array.isArray(reports));
  assert.equal(reports.length, expected);
  for (const [score, steps, terminal] of reports) {
    assert.ok(Number.isInteger(score) && score >= 0 && score <= U32_MAX);
    assert.ok(terminal === 0 || terminal === 1);
    record(sum, {score: float(score), steps, reason: {$: terminal ? 'Terminal' : 'Limit'}});
  }
  return sum;
}
function compare(exe, dir, archived) {
  const p = archived.body.plan;
  status(dir, true);
  const config = settings(p.arms[0],p.games[0]);
  const lines = execFileSync(path.resolve(exe), [], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
  }).trim().split('\n');
  assert.equal(lines.shift(), digest(canonical(p)), 'this executable was generated for another plan');
  assert.equal(lines.length, p.replicates * p.checkpoints.length);
  const game = p.games[0].id, arm = p.arms[0].id;
  let index = 0;
  for (let rep = 0; rep < p.replicates; ++rep) {
    let parent = null, done = 0, train = stats();
    for (const point of p.checkpoints) {
      const [r,n,tr,va,te,table] = JSON.parse(lines[index++]);
      assert.deepEqual([r,n], [rep,point]);
      const body = {
        experiment: archived.hash, parent, game, arm, rep, episodes: point,
        model: model(table,config,p.games[0].definition), train: accumulate(train,tr,point-done), partial: null, started: point,
        validation: accumulate(stats(),va,p.validationEpisodes), test: null,
      };
      if (point === p.checkpoints.at(-1) && p.testEpisodes)
        body.test = accumulate(stats(),te,p.testEpisodes);
      else assert.equal(te,null);
      const file = path.join(dir,'trials',game,arm,String(rep),point+'.json');
      const exact = unseal(file), candidate = seal(body);
      if (candidate !== fs.readFileSync(file,'utf8')) {
        for (const key of Object.keys(body))
          assert.deepEqual(body[key],exact.body[key], 'parity mismatch at '+rep+':'+point+' '+key);
        assert.fail('checkpoint bytes differ despite equal decoded fields at '+rep+':'+point);
      }
      done = point; parent = exact.hash;
    }
  }
  for (const packed of p.arms[0].method === 'random' ? [] : [false, true]) {
    if (canonical(readPlan(fixture(packed,p.arms[0].method))) !== canonical(p)) continue;
    const trace = JSON.parse(execFileSync(process.execPath, [
      path.join(dir, 'code/experiment.mjs'), 'replay', dir, game, arm, '0', '0', 'train', '0',
    ], {encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5000}));
    assert.equal(trace.seed, 3188627573);
    const first = trace.frames[0];
    assert.equal(first.observation, 0x80000003);
    assert.deepEqual(first.legal, [U32_MAX, 0, 3]);
    assert.equal(first.action, 3);
    assert.equal(first.accepted, true);
    const {model: firstModel} = unseal(path.join(dir,'trials',game,arm,'0','1.json')).body;
    let firstTable = firstModel.$ === 'PlanningAgent' ? firstModel.state.values : firstModel.values;
    if (firstModel.$ === 'DoubleAgent') {
      // The fixture's initial private update seed mixes to 3292062309 (odd).
      const {model: initialModel} = unseal(path.join(dir,'trials',game,arm,'0','0.json')).body;
      assert.equal(initialModel.tables.seed, 54066933);
      firstTable = firstModel.tables.right;
    }
    assert.equal(firstTable.head.tree.a, 3);
    console.log('The archived rare-tie replay and matching native tree visit action ID 3 first.');
  }
  console.log(index + ' complete checkpoint files matched the stock archived bytes. No native archive written.');
}

function writeSource(pathname, plan) {
  const source = fs.readFileSync(path.join(own, 'q.c'), 'utf8');
  output(pathname, source.replace('/* GENERATED */', generated(plan)));
}

const [mode, file, extra, fourth, ...rest] = process.argv.slice(2);
if (mode === 'fixture' && file && !rest.length && ['literal','packed'].includes(extra) &&
    methods.includes(fourth ?? 'q_learning')) {
  const plan = fixture(extra === 'packed',fourth ?? 'q_learning');
  requireEligible(readPlan(plan));
  output(file, numberPreservingJson(plan,2)+'\n');
} else if (mode === 'generate-plan' && file && extra && !fourth) {
  writeSource(extra, readPlan(path.resolve(file)));
} else if (['generate','check'].includes(mode) && file && extra && !fourth) {
  const archive = unseal(manifestPath(file));
  checkedSnapshot(file,archive);
  assert.equal(archive.body.toolchain.node,process.versions.node);
  assert.equal(archive.body.toolchain.bend,'bend 2.0.40');
  requireEligible(archive.body.plan);
  if (mode === 'generate') writeSource(extra, archive.body.plan);
  else compare(extra, file, archive);
} else throw Error('usage: parity.mjs fixture NEW_PLAN literal|packed [' + methods.join('|') + '] | generate-plan PLAN NEW_C | generate TRUSTED_STOCK_RUN NEW_C | check TRUSTED_STOCK_RUN TRUSTED_NATIVE_EXE');
