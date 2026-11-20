import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {loadFiniteWorld, MAX_LIMIT} from '../integrations/finite-session.mjs';
import {str, tool, uint} from './schema.mjs';

const TTL_MS = 10 * 60_000;
const SERVER_CAP = 32;
const WORLD_CAP = 4;
function filename(world, ctx) {
  const file = ctx.input(world);
  if (path.extname(file).toLowerCase() !== '.json')
    throw Error('expected a finite JSON world path');
  if (!fs.statSync(file).isFile()) throw Error('expected a regular world file');
  return fs.realpathSync(file);
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
    const size = prune();
    const sessions = worlds.get(file) ?? new Map();
    if (sessions.size >= worldCap || size >= serverCap)
      throw Error('environment session capacity reached');
    const episode = loadFiniteWorld(file).start(args.seed, args.limit ?? 256);
    const start = episode.initial;
    if (start.terminal) return {...start, session: null};
    const token = randomBytes(24).toString('hex');
    sessions.set(token, {episode, expires: now() + ttl});
    worlds.set(file, sessions);
    return {...start, session: token};
  }
  function step(args, ctx) {
    const file = filename(args.world, ctx);
    prune();
    const sessions = worlds.get(file);
    const session = sessions?.get(args.session);
    if (!session) throw Error('no active environment session for this world');
    const result = session.episode.step(args.action);
    if (result.done) sessions.delete(args.session);
    return result;
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
