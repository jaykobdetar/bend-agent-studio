import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {buckets, worldDefinition} from '../core/finite_world.mjs';
import {str, tool, uint} from './schema.mjs';

const WORDS = 2 ** 32;
const FILE_CAP = 2 ** 20;
const STATE_CAP = 4096;
const OUTCOME_CAP = 16384;
const MAX_LIMIT = 4096;
const TTL_MS = 10 * 60_000;
const SERVER_CAP = 32;
const WORLD_CAP = 4;

// Mirrors the pinned engine's unsigned LCG and mix_word. Reuse the canonical
// JS bucket constructor used to emit both literal and packed Bend worlds.
const nextSeed = (word) => (Math.imul(word, 1664525) + 1013904223) >>> 0;
function mix(word) {
  word = Math.imul(word ^ (word >>> 16), 2246822507);
  word = Math.imul(word ^ (word >>> 13), 3266489909);
  return (word ^ (word >>> 16)) >>> 0;
}

function word(value, name) {
  if (!Number.isInteger(value) || value < 0 || value >= WORDS) throw Error('invalid U32 ' + name);
  return value;
}

function pick(distribution, word) {
  // The cumulative bounds are inclusive and can contain equal neighbors for
  // zero-width buckets. Find the first upper bound at least as large as word.
  let lo = 0,
    hi = distribution.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (word <= distribution[mid].upper) hi = mid;
    else lo = mid + 1;
  }
  return distribution[lo];
}

function filename(world, ctx) {
  const file = ctx.input(world);
  if (path.extname(file).toLowerCase() !== '.json')
    throw Error('expected a finite JSON world path');
  if (!fs.statSync(file).isFile()) throw Error('expected a regular world file');
  return fs.realpathSync(file);
}

function load(file) {
  const fd = fs.openSync(file, 'r');
  let raw;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > FILE_CAP)
      throw Error('world exceeds 1 MiB or is not a regular file');
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (!size) break;
      count += size;
    }
    if (count !== stat.size) throw Error('world file changed during read');
    raw = JSON.parse(bytes.toString('utf8', 0, count));
  } finally {
    fs.closeSync(fd);
  }
  if (
    Array.isArray(raw?.grid) &&
    raw.grid.reduce((n, row) => n + (typeof row === 'string' ? row.length : 0), 0) > STATE_CAP
  )
    throw Error('world grid exceeds 4096 cells');
  const definition = worldDefinition(raw);
  if (definition.states.length > STATE_CAP) throw Error('world exceeds 4096 states');
  let outcomes = definition.initial.length;
  for (const state of definition.states)
    for (const action of state.actions) outcomes += action.outcomes.length;
  if (outcomes > OUTCOME_CAP) throw Error('world exceeds 16,384 total outcomes');
  const states = new Map(
    definition.states.map((state) => [
      state.id,
      {
        observation: state.observation,
        actions: new Map(state.actions.map((a) => [a.id, buckets(a.outcomes)])),
      },
    ]),
  );
  return {initial: buckets(definition.initial), states};
}

function view(entry) {
  return {observation: entry.observation, legal: [...entry.actions.keys()]};
}

export function environmentSessions({
  now = () => performance.now(),
  ttl = TTL_MS,
  serverCap = SERVER_CAP,
  worldCap = WORLD_CAP,
} = {}) {
  // One store per stdio server. Session handles are independent bearer tokens,
  // and an identically named world in another server cannot use this store.
  const worlds = new Map();
  function prune() {
    const time = now();
    let size = 0;
    for (const [file, sessions] of worlds) {
      for (const [token, entry] of sessions) if (entry.expires <= time) sessions.delete(token);
      if (sessions.size === 0) worlds.delete(file);
      else size += sessions.size;
    }
    return size;
  }
  function reset(args, ctx) {
    const file = filename(args.world, ctx);
    const seed = word(args.seed, 'seed');
    const limit = args.limit ?? 256;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw Error('invalid episode limit');
    const size = prune();
    const sessions = worlds.get(file) ?? new Map();
    if (sessions.size >= worldCap || size >= serverCap)
      throw Error('environment session capacity reached');
    const {initial, states} = load(file);
    const state = pick(initial, mix(seed ^ 3266489917)).to;
    const start = view(states.get(state));
    const terminal = !start.legal.length;
    if (terminal) return {...start, terminal, session: null};
    const token = randomBytes(24).toString('hex');
    sessions.set(token, {
      state,
      seed: nextSeed(seed),
      states,
      remaining: limit,
      expires: now() + ttl,
    });
    worlds.set(file, sessions);
    return {...start, terminal, session: token};
  }
  function step(args, ctx) {
    const file = filename(args.world, ctx);
    const action = word(args.action, 'action');
    prune();
    const sessions = worlds.get(file);
    const session = sessions?.get(args.session);
    if (!session) throw Error('no active environment session for this world');
    const current = session.states.get(session.state);
    const start = view(current);
    const distribution = current.actions.get(action);
    const frame = {...start, action, accepted: Boolean(distribution)};
    if (!distribution) {
      // Engine stops on an illegal action without advancing the world.
      sessions.delete(args.session);
      return {frame, done: true};
    }
    const actionSeed = nextSeed(session.seed);
    const outcome = pick(distribution, mix(actionSeed ^ 2779096485));
    const next = view(session.states.get(outcome.to));
    session.seed = nextSeed(actionSeed);
    session.state = outcome.to;
    session.remaining--;
    const terminal = !next.legal.length;
    const truncated = !terminal && session.remaining === 0;
    const done = terminal || truncated;
    if (done) sessions.delete(args.session);
    return {
      frame: {
        ...frame,
        reward: outcome.reward,
        nextObservation: next.observation,
        nextLegal: next.legal,
        terminal,
        truncated,
      },
      done,
    };
  }
  return {reset, step, prune, clear: () => worlds.clear()};
}

export function environmentTools() {
  const sessions = environmentSessions();
  const timer = setInterval(sessions.prune, 60_000);
  timer.unref();
  return {
    tools: {
      env_reset: tool(
        'Start a bounded seeded episode in a finite workspace JSON world.',
        {world: str, seed: uint, limit: {type: 'integer', minimum: 1, maximum: MAX_LIMIT}},
        ['world', 'seed'],
        false,
        sessions.reset,
      ),
      env_step: tool(
        'Play one action and return its public replay-compatible frame.',
        {world: str, session: {type: 'string', pattern: '^[0-9a-f]{48}$'}, action: uint},
        ['world', 'session', 'action'],
        false,
        sessions.step,
      ),
    },
    close() {
      clearInterval(timer);
      sessions.clear();
    },
  };
}
