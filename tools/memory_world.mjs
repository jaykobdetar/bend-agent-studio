import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {worldDefinition} from '../core/finite_world.mjs';

// Build the product of a finite world and a memory machine over public events.
// Outcome order is significant because the Bend compiler partitions U32 draws by it.
export function memoryWorld(world, spec, {maxStates = 100000, taskHorizon = null} = {}) {
  const form = spec?.output ?? 'pair';
  const u32 = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 4294967295;
  if (
    !spec ||
    Object.keys(spec).some(
      (k) =>
        ![
          'schema',
          'states',
          'initial',
          'observationStride',
          'otherwise',
          'rules',
          'output',
        ].includes(k),
    ) ||
    spec.schema !== 1 ||
    !['pair', 'memory'].includes(form) ||
    !u32(spec.states) ||
    spec.states === 0 ||
    !u32(spec.initial) ||
    spec.initial >= spec.states ||
    !Number.isSafeInteger(spec.observationStride) ||
    spec.observationStride < 1 ||
    (form === 'pair' && BigInt(spec.observationStride) * BigInt(spec.states) > 4294967296n) ||
    spec.otherwise !== 'keep' ||
    !Array.isArray(spec.rules) ||
    !Number.isSafeInteger(maxStates) ||
    maxStates < 1 ||
    (taskHorizon !== null && (!Number.isSafeInteger(taskHorizon) || taskHorizon < 0))
  )
    throw Error('invalid memory machine dimensions or defaults');
  const fields = ['from', 'observation', 'action', 'reward', 'nextObservation'],
    allowed = new Set([...fields, 'to']);
  for (const rule of spec.rules) {
    if (
      !rule ||
      typeof rule !== 'object' ||
      Object.keys(rule).some((k) => !allowed.has(k)) ||
      !u32(rule.to) ||
      rule.to >= spec.states
    )
      throw Error('invalid memory rule or destination');
    for (const k of fields)
      if (Object.hasOwn(rule, k)) {
        const x = rule[k];
        const valid =
          k === 'reward'
            ? Number.isFinite(x) && Number.isFinite(Math.fround(x))
            : u32(x) &&
              (k !== 'from' || x < spec.states) &&
              (!['observation', 'nextObservation'].includes(k) || x < spec.observationStride);
        if (!valid) throw Error('invalid memory rule field ' + k);
      }
  }
  const rules = spec.rules.map((rule) =>
    Object.hasOwn(rule, 'reward') ? {...rule, reward: Math.fround(rule.reward)} : rule,
  );
  const equal = (k, a, b) => (k === 'reward' ? Object.is(a, b) : a === b);
  // Two matching predicates must agree on their destination. Rules have no priority.
  for (let i = 0; i < rules.length; i++)
    for (let j = 0; j < i; j++) {
      const a = rules[i],
        b = rules[j];
      if (
        a.to !== b.to &&
        fields.every((k) => !Object.hasOwn(a, k) || !Object.hasOwn(b, k) || equal(k, a[k], b[k]))
      )
        throw Error('overlapping memory rules disagree: ' + j + ' and ' + i);
    }
  const byId = new Map(world.states.map((s) => [s.id, s]));
  const getObservation = (s) => s.observation ?? s.id;
  for (const s of world.states)
    if (!u32(getObservation(s)) || getObservation(s) >= spec.observationStride)
      throw Error('world observation lies outside the fixed observation stride');
  function advance(mem, obs, action, reward, nextObservation) {
    const event = {
      from: mem,
      observation: obs,
      action,
      reward: Math.fround(reward),
      nextObservation,
    };
    for (const rule of rules)
      if (fields.every((k) => !Object.hasOwn(rule, k) || equal(k, rule[k], event[k])))
        return rule.to;
    return mem;
  }
  const pairs = [],
    ids = new Map(),
    states = [];
  function include(id, memory, depth) {
    if (!byId.has(id)) throw Error('world refers to missing state ' + id);
    const key = id + '/' + memory + (taskHorizon === null ? '' : '/' + depth);
    if (ids.has(key)) return ids.get(key);
    if (pairs.length >= maxStates || pairs.length >= 4294967296)
      throw Error('memory-product state budget exceeded');
    const index = pairs.length;
    pairs.push({id, memory, depth});
    ids.set(key, index);
    return index;
  }
  const initial = world.initial.map((e) => ({
    to: include(e.to, spec.initial, 0),
    weight: e.weight,
  }));
  for (let i = 0; i < pairs.length; i++) {
    const {id, memory, depth} = pairs[i],
      original = byId.get(id),
      obs = getObservation(original);
    const actions =
      depth === taskHorizon
        ? []
        : original.actions.map((a) => ({
            id: a.id,
            outcomes: a.outcomes.map((e) => {
              const after = getObservation(byId.get(e.to));
              const next = advance(memory, obs, a.id, e.reward, after);
              return {
                to: include(e.to, next, taskHorizon === null ? 0 : depth + 1),
                weight: e.weight,
                reward: e.reward,
              };
            }),
          }));
    states.push({
      id: i,
      observation: form === 'memory' ? memory : memory * spec.observationStride + obs,
      actions,
    });
  }
  return {schema: 1, initial, states};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [file, rules, ...rest] = process.argv.slice(2);
    if (!file || !rules || (rest.length && (rest.length !== 2 || rest[0] !== '--task-horizon')))
      throw Error('usage: node tools/memory_world.mjs WORLD.json MEMORY.json [--task-horizon N]');
    const world = worldDefinition(JSON.parse(fs.readFileSync(file, 'utf8')));
    const product = memoryWorld(world, JSON.parse(fs.readFileSync(rules, 'utf8')), {
      taskHorizon: rest.length ? Number(rest[1]) : null,
    });
    console.log(JSON.stringify(product, (_k, v) => (Object.is(v, -0) ? JSON.rawJSON('-0') : v), 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
