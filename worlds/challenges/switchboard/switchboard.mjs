import { memoryWorld } from '../../../tools/memory_world.mjs';

export const encodings = ['raw', 'latest', 'full'];
const noop = 2;

export function switchboardHorizon(
  width,
  delay,
  encoding,
  { native = false } = {},
) {
  const permitted = native ? [2, 4, 8, 16] : [2, 4, 8];
  if (!permitted.includes(width))
    throw Error('width must be ' + permitted.join(', '));
  if (!Number.isInteger(delay) || delay < 0 || delay > 128)
    throw Error('delay must be an integer in [0, 128]');
  if (!encodings.includes(encoding))
    throw Error('unknown switchboard encoding');
  // The maximum observation is the full mask encoded with the terminal event.
  if ((3 * width + 2) * 2 ** width - 1 > 0xffffffff)
    throw Error('switchboard observations would exceed U32');
  return width + delay + 1;
}

export function switchboard(width, delay, encoding = 'raw') {
  const horizon = switchboardHorizon(width, delay, encoding);
  const bits = 2 ** width;
  const blank = 2 * width;
  const query = blank + 1;
  const end = query + width;
  const stride = end + 1;
  const cue = (i, bit) => 2 * i + bit;
  const terminal = { id: 0, observation: end, actions: [] };
  const states = [terminal];
  const add = (observation) => {
    const id = states.length;
    states.push({ id, observation, actions: [] });
    return id;
  };

  // A mask is an underlying state, never an observation in the base world.
  const cues = Array.from({ length: width }, (_, i) =>
    Array.from({ length: 2 ** (i + 1) }, (_, mask) =>
      add(cue(i, (mask >> i) & 1)),
    ),
  );
  const blanks = Array.from({ length: delay }, () =>
    Array.from({ length: bits }, () => add(blank)),
  );
  const queries = Array.from({ length: bits }, () =>
    Array.from({ length: width }, (_, i) => add(query + i)),
  );
  const edge = (to, reward = 0) => ({ to, weight: 1, reward });
  const assignNoop = (from, outcomes) => {
    states[from].actions = [{ id: noop, outcomes }];
  };
  for (const [i, row] of cues.entries()) {
    for (const [mask, id] of row.entries()) {
      assignNoop(
        id,
        i < width - 1
          ? [edge(cues[i + 1][mask]), edge(cues[i + 1][mask | (1 << (i + 1))])]
          : delay
            ? [edge(blanks[0][mask])]
            : queries[mask].map((next) => edge(next)),
      );
    }
  }
  for (const [i, row] of blanks.entries()) {
    for (const [mask, id] of row.entries())
      assignNoop(
        id,
        i < delay - 1
          ? [edge(blanks[i + 1][mask])]
          : queries[mask].map((next) => edge(next)),
      );
  }
  for (const [mask, row] of queries.entries()) {
    for (const [i, id] of row.entries())
      states[id].actions = [0, 1].map((guess) => ({
        id: guess,
        outcomes: [edge(terminal.id, guess === ((mask >> i) & 1) ? 1 : -1)],
      }));
  }

  const definition = {
    schema: 1,
    initial: cues[0].map((to) => ({ to, weight: 1 })),
    states,
  };
  if (encoding === 'raw') return { definition, horizon, stride };

  const rules = [];
  for (let i = 0; i < width; i++) {
    for (const bit of [0, 1]) {
      if (encoding === 'latest') {
        rules.push({ observation: cue(i, bit), action: noop, to: bit });
      } else {
        for (let from = 0; from < 2 ** i; from++)
          rules.push({
            from,
            observation: cue(i, bit),
            action: noop,
            to: from | (bit << i),
          });
      }
    }
  }
  return {
    definition: memoryWorld(definition, {
      schema: 1,
      states: encoding === 'latest' ? 2 : bits,
      initial: 0,
      observationStride: stride,
      otherwise: 'keep',
      rules,
    }),
    horizon,
    stride,
  };
}
