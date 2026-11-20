// Shared, bounded finite-world playback. The session never exposes hidden state.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buckets, numberPreservingJson, worldDefinition} from '../core/finite_world.mjs';
const WORDS = 2 ** 32;
const FILE_CAP = 2 ** 20;
const STATE_CAP = 4096;
const OUTCOME_CAP = 16384;
export const MAX_LIMIT = 4096;

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

export function loadFiniteWorld(file) {
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
  const initial = buckets(definition.initial);
  let sha256;
  return {
    get sha256() {
      return (sha256 ??= createHash('sha256')
        .update(numberPreservingJson(definition))
        .digest('hex'));
    },
    grid: raw.grid ?? null,
    start(seed, limit) {
      word(seed, 'seed');
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
        throw Error('invalid episode limit');
      let current = states.get(pick(initial, mix(seed ^ 3266489917)).to);
      let draw = nextSeed(seed);
      let remaining = limit;
      const opening = view(current);
      let done = !opening.legal.length;
      return {
        initial: {...opening, terminal: done},
        step(action) {
          word(action, 'action');
          if (done) throw Error('episode is complete');
          const distribution = current.actions.get(action);
          const frame = {...view(current), action, accepted: Boolean(distribution)};
          if (!distribution) {
            done = true;
            return {frame, done};
          }
          const actionSeed = nextSeed(draw);
          const outcome = pick(distribution, mix(actionSeed ^ 2779096485));
          current = states.get(outcome.to);
          draw = nextSeed(actionSeed);
          remaining--;
          const next = view(current);
          const terminal = !next.legal.length;
          const truncated = !terminal && remaining === 0;
          done = terminal || truncated;
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
        },
      };
    },
  };
}

function view(entry) {
  return {observation: entry.observation, legal: [...entry.actions.keys()]};
}
