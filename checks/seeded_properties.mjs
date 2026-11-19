import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validate} from '../core/experiment_config.mjs';
import {worldDefinition} from '../core/finite_world.mjs';
import {exportPomdp} from '../tools/export_pomdp.mjs';
import {memoryWorld} from '../tools/memory_world.mjs';
import {context} from '../mcp/context.mjs';

const U32 = 2 ** 32;
export const defaults = {cases: 64, seed: 0x9a752024};
export function seeded(seed) {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / U32) * n);
  };
}
function campaign(name, {cases, seed}, property) {
  const seeds = seeded(seed);
  for (let i = 0; i < cases; i++) {
    const input = seeds(U32);
    try {
      property(seeded(input), i);
    } catch (e) {
      throw Error(`${name}: seed ${seed}, case ${i}, case seed ${input}: ${e.message}`, {cause: e});
    }
  }
}
function plan(random) {
  const n = 1 + random(5),
    interval = 1 + random(8);
  return {
    schema: 1,
    name: 'generated',
    games: [{id: 'cliff', limit: 1 + random(100)}],
    arms: Array.from({length: n}, (_, i) => ({
      id: 'candidate-' + i,
      method: ['random', 'q_learning', 'expected_sarsa'][random(3)],
    })),
    replicates: 1 + random(4),
    checkpoints: [0, interval, 2 * interval],
    validationEpisodes: 1 + random(4),
    testEpisodes: random(4),
    seeds: {
      train: random(100),
      validation: 10000 + random(100),
      test: 20000 + random(100),
      stride: 200,
    },
  };
}
function manifests(random, i) {
  const spec = plan(random),
    normalized = validate(spec);
  assert.equal(normalized.arms.length, spec.arms.length);
  assert.deepEqual(normalized.checkpoints, spec.checkpoints);
  assert.equal(normalized.games[0].limit, spec.games[0].limit);
  const bad = structuredClone(spec);
  switch (i % 7) {
    case 0:
      bad.checkpoints[1] = bad.checkpoints[0];
      break;
    case 1:
      bad.arms.push(bad.arms[0]);
      break;
    case 2:
      bad.seeds.validation = bad.seeds.train;
      break;
    case 3:
      bad.games[0].limit = 0;
      break;
    case 4:
      bad.games[0].id = 'missing';
      break;
    case 5:
      bad.replicates = 0;
      break;
    case 6:
      bad.arms[0].epsilon = 1.1;
      break;
  }
  assert.throws(() => validate(bad), Error);
}
export function finite(random) {
  const ids = Array.from({length: 2 + random(6)}, (_, i) => 5 + 7 * i);
  const state = (id) => ({
    id,
    observation: random(4),
    actions: Array.from({length: random(4)}, (_, a) => ({
      id: a * 7,
      outcomes: Array.from({length: 1 + random(5)}, () => ({
        to: ids[random(ids.length)],
        weight: 1 + random(13),
        reward: (random(25) - 12) / 4,
      })),
    })),
  });
  return {
    schema: 1,
    initial: ids.map((to) => ({to, weight: 1 + random(5)})),
    states: ids.map(state),
  };
}
function grid(random, i) {
  const width = 2 + random(6),
    height = 2 + random(6);
  const data = Array.from({length: height}, () =>
    Array.from({length: width}, () => '.#PP.G.'[random(7)]),
  );
  data[0][0] = 'S';
  const input = {schema: 1, grid: data.map((row) => row.join('')), slip: random(17) / 16};
  const world = worldDefinition(input);
  assert.deepEqual(worldDefinition(world), world);
  assert.equal(world.states.length, data.flat().filter((c) => c !== '#').length);
  assert.deepEqual(world.initial, [{to: 0, weight: 1}]);
  const steps = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
  ];
  for (const {id, observation, actions} of world.states) {
    assert.equal(observation, id);
    const r = Math.floor(id / width),
      c = id % width,
      cell = data[r][c];
    const neighbors = steps.flatMap(([dy, dx], a) => {
      const y = r + dy,
        x = c + dx,
        target = data[y]?.[x];
      return target && target !== '#'
        ? [{a, to: y * width + x, reward: target === 'G' ? 0 : target === 'P' ? -10 : -1}]
        : [];
    });
    assert.deepEqual(
      actions.map((a) => a.id),
      ['G', 'P'].includes(cell) ? [] : neighbors.map((n) => n.a),
    );
    for (const action of actions) {
      const draw = Math.round(input.slip * 65536);
      assert.deepEqual(
        action.outcomes,
        neighbors
          .filter((n) => draw > 0 || n.a === action.id)
          .map((n) => ({
            to: n.to,
            reward: n.reward,
            weight: draw + (n.a === action.id ? (65536 - draw) * neighbors.length : 0),
          })),
      );
    }
  }
  const bad = structuredClone(input);
  if (i % 3 === 0) bad.grid[1] += '.';
  else if (i % 3 === 1) bad.grid[0] = bad.grid[0].replace('S', '.');
  else bad.slip = -0.25;
  assert.throws(() => worldDefinition(bad), Error);
}
function worlds(random, i) {
  if (i % 2 === 0) {
    grid(random, i >> 1);
    return;
  }
  const w = finite(random),
    normalized = worldDefinition(w);
  assert.deepEqual(worldDefinition(normalized), normalized);
  const bad = structuredClone(w);
  if (i % 3 === 0) bad.states[1].id = bad.states[0].id;
  else if (i % 3 === 1) bad.initial[0].weight = 0;
  else bad.initial[0].to = U32 - 1;
  assert.throws(() => worldDefinition(bad), Error);
}
function memory(random, i) {
  const w = worldDefinition(finite(random)),
    n = 2 + random(3),
    stride = 4,
    initial = random(n);
  // Unique (from,observation) predicates let an independent table compute the update.
  const target = Array.from({length: n}, () =>
    Array.from({length: stride}, () => random(n + 1) - 1),
  );
  const rules = target.flatMap((row, from) =>
    row.flatMap((to, observation) => (to < 0 ? [] : [{from, observation, to}])),
  );
  const spec = {schema: 1, states: n, initial, observationStride: stride, otherwise: 'keep', rules};
  const horizon = 1 + random(4),
    product = worldDefinition(memoryWorld(w, spec, {taskHorizon: horizon}));
  const byId = new Map(w.states.map((s) => [s.id, s])),
    actual = new Map(product.states.map((s) => [s.id, s]));
  const todo = product.initial.map(({to, weight}, j) => {
    assert.equal(weight, w.initial[j].weight);
    return {to, id: w.initial[j].to, m: initial, d: 0};
  });
  const seen = new Map();
  for (let j = 0; j < todo.length; j++) {
    const {to, id, m, d} = todo[j],
      key = `${id}/${m}/${d}`;
    if (seen.has(to)) {
      assert.equal(seen.get(to), key);
      continue;
    }
    seen.set(to, key);
    const a = actual.get(to),
      f = byId.get(id);
    assert.equal(a.observation, m * stride + f.observation);
    const actions = d === horizon ? [] : f.actions;
    assert.deepEqual(
      a.actions.map((x) => x.id),
      actions.map((x) => x.id),
    );
    for (const [k, {outcomes}] of actions.entries()) {
      assert.equal(a.actions[k].outcomes.length, outcomes.length);
      for (const [l, edge] of outcomes.entries()) {
        const back = a.actions[k].outcomes[l];
        assert.equal(back.reward, edge.reward);
        assert.equal(back.weight, edge.weight);
        const next = target[m][f.observation];
        todo.push({to: back.to, id: edge.to, m: next < 0 ? m : next, d: d + 1});
      }
    }
  }
  assert.equal(seen.size, actual.size);
  assert.equal(new Set(seen.values()).size, actual.size);
  const invalid = structuredClone(spec);
  if (i % 2 === 0) invalid.rules.push({observation: 0, to: 0}, {observation: 0, to: 1});
  else invalid.rules.push({from: n, to: 0});
  assert.throws(() => memoryWorld(w, invalid), Error);
}

// Read the sparse Cassandra subset emitted by the exporter; expand named
// records and wildcards and compare with an independent U32 partition oracle.
function parseSparse(text) {
  const fields = {},
    rows = [];
  for (const line of text.trim().split('\n')) {
    const [name, ...data] = line.split(':').map((s) => s.trim());
    if (['T', 'O', 'R'].includes(name)) rows.push([name, ...data]);
    else {
      assert.equal(data.length, 1);
      assert.ok(!Object.hasOwn(fields, name));
      fields[name] = data[0].split(' ');
    }
  }
  const {states, actions, observations} = fields;
  const T = new Map(),
    O = new Map(),
    R = new Map();
  function set(map, key, value) {
    assert.ok(!map.has(key), 'duplicate sparse entry ' + key);
    assert.ok(Number.isFinite(value));
    map.set(key, value);
  }
  for (const [kind, a, from, to, ...last] of rows) {
    const candidates = a === '*' ? actions : [a];
    assert.ok(candidates.every((a) => actions.includes(a)));
    assert.ok(states.includes(from));
    if (kind === 'R') {
      assert.ok(states.includes(to));
      const [wild, v] = last[0].split(' ');
      assert.equal(wild, '*');
      for (const a of candidates) set(R, [a, from, to].join(':'), Number(v));
    } else {
      const [target, v] = to.split(' ');
      assert.ok((kind === 'T' ? states : observations).includes(target));
      for (const a of candidates) set(kind === 'T' ? T : O, [a, from, target].join(':'), Number(v));
    }
  }
  return {fields, T, O, R};
}
function probability(rows) {
  const full = 4294967296n,
    total = rows.reduce((n, x) => n + BigInt(x.weight), 0n);
  let lower = 0n,
    sum = 0n;
  return rows.map((x) => {
    sum += BigInt(x.weight);
    const upper = (sum * full) / total,
      p = Number(upper - lower) / U32;
    lower = upper;
    return {...x, p};
  });
}
function roundtrip(random) {
  const w = worldDefinition(finite(random)),
    options = {discount: random(17) / 16, illegalPenalty: -123};
  const {fields, T, O, R} = parseSparse(exportPomdp(w, options)),
    {states, actions, observations, start} = fields;
  assert.equal(Number(fields.discount[0]), options.discount);
  assert.deepEqual(fields.values, ['reward']);
  assert.deepEqual(states, [...w.states.map((s) => 's' + s.id), 'sink']);
  const initial = new Map(probability(w.initial).map((x) => ['s' + x.to, x.p]));
  assert.deepEqual(
    start.map(Number),
    states.map((s) => initial.get(s) ?? 0),
  );
  const same = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12, `${a} != ${b}`);
  for (const s of [...w.states, {id: 'ink', observation: 'sink', actions: []}])
    for (const a of actions) {
      const from = 's' + s.id,
        declared = s.actions.find((x) => 'a' + x.id === a);
      const expected = declared
        ? probability(declared.outcomes)
        : [
            {
              to: s.actions.length ? 'ink' : s.id,
              p: 1,
              reward: s.actions.length ? options.illegalPenalty : 0,
            },
          ];
      for (const to of states) {
        const events = expected.filter((x) => 's' + x.to === to);
        const total = events.reduce((n, x) => n + x.p, 0);
        const rewardMass = events.reduce((n, x) => n + x.p * x.reward, 0);
        const key = [a, from, to].join(':');
        same(T.get(key) ?? 0, total);
        same((R.get(key) ?? 0) * total, rewardMass);
      }
      for (const obs of observations)
        assert.equal(O.get([a, from, obs].join(':')) ?? 0, Number(obs === 'o' + s.observation));
    }
}
function confinement(config) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bend-properties-')));
  try {
    const root = path.join(temporary, 'workspace'),
      neighbor = path.join(temporary, 'neighbor');
    fs.mkdirSync(root);
    fs.mkdirSync(neighbor);
    const ctx = context(root);
    campaign('MCP workspace paths', config, (random, i) => {
      const dir = path.join(root, 'd' + random(U32).toString(16) + '-' + i);
      fs.mkdirSync(dir);
      const filename = 'input.json',
        allowed = path.join(dir, filename);
      fs.writeFileSync(allowed, 'seeded fixture');
      const denied = path.join(neighbor, i + '.json');
      fs.writeFileSync(denied, 'neighbor fixture');
      assert.equal(ctx.input(path.relative(root, allowed)), allowed);
      assert.equal(
        ctx.output(path.relative(root, path.join(dir, 'new.json'))),
        path.join(dir, 'new.json'),
      );
      assert.throws(() => ctx.output(allowed), /output already exists/);
      assert.throws(
        () => ctx.input(random(2) ? denied : path.relative(root, denied)),
        /outside workspace/,
      );
      assert.throws(
        () => ctx.output(path.join(neighbor, 'new-' + i + '.json')),
        /outside workspace/,
      );
      assert.equal(fs.readFileSync(denied, 'utf8'), 'neighbor fixture');
    });
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}
export function properties(config = defaults) {
  for (const [name, f] of Object.entries({manifests, worlds, memory, roundtrip}))
    campaign(name, config, f);
  confinement(config);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2),
    config = {...defaults};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].slice(2),
      value = Number(args[i + 1]);
    if (
      !['seed', 'cases'].includes(name) ||
      !args[i].startsWith('--') ||
      !Number.isInteger(value) ||
      value < 0 ||
      (name === 'seed' && value >= U32) ||
      (name === 'cases' && (value < 1 || value > 100000))
    )
      throw Error('use --seed U32 --cases 1..100000');
    config[name] = value;
  }
  properties(config);
  console.log(`Seeded properties verified: ${config.cases} cases per domain, seed ${config.seed}.`);
}
