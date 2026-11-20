// Portable data-only inference for a fitted Bend clone. Count ties follow the public list order.
export function portablePolicy(world, fit) {
  if (
    fit?.schema !== 'bend-demonstration-fit-v1' ||
    fit.method !== 'behavior_cloning' ||
    fit.worldSha256 !== world.sha256
  )
    throw Error('wrong fitted policy format or world');
  if (
    !Number.isInteger(fit.limit) ||
    fit.limit < 1 ||
    fit.limit > 512 ||
    !Array.isArray(fit.policy?.rows) ||
    !fit.policy.rows.length ||
    fit.policy.rows.length > 4096
  )
    throw Error('invalid clone policy');
  const word = (n) => Number.isInteger(n) && n >= 0 && n < 2 ** 32;
  const table = new Map();
  let sum = 0;
  for (const {observation, counts} of fit.policy.rows) {
    if (!word(observation) || table.has(observation) || !Array.isArray(counts) || !counts.length)
      throw Error('invalid clone observation');
    const row = new Map();
    for (const {action, n} of counts) {
      if (!word(action) || row.has(action) || !Number.isSafeInteger(n) || n <= 0)
        throw Error('invalid action count');
      sum += n;
      if (sum > 4096) throw Error('too many fitted transitions');
      row.set(action, n);
    }
    table.set(observation, row);
  }
  return ({observation, legal}) => {
    if (!legal.length) throw Error('cannot act at terminal view');
    const row = table.get(observation);
    return legal.reduce((best, a) => ((row?.get(a) ?? 0) > (row?.get(best) ?? 0) ? a : best));
  };
}

export function freezeController(world, fit) {
  portablePolicy(world, fit);
  const sources = fit.training?.demonstrations;
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.length > 128 ||
    sources.some(
      (s) =>
        !/^[a-f0-9]{64}$/.test(s.sha256) ||
        !Number.isInteger(s.seed) ||
        s.seed < 0 ||
        s.seed >= 2 ** 32,
    ) ||
    new Set(sources.map((s) => s.sha256)).size !== sources.length ||
    new Set(sources.map((s) => s.seed)).size !== sources.length
  )
    throw Error('invalid controller training references');
  // Deliberately omit evaluation outcomes: collection is conditioned on the frozen policy, not a score.
  return {
    schema: 'bend-demonstration-fit-v1',
    method: 'behavior_cloning',
    worldSha256: fit.worldSha256,
    limit: fit.limit,
    training: {demonstrations: sources.map(({sha256, seed}) => ({sha256, seed}))},
    policy: {
      rows: fit.policy.rows.map(({observation, counts}) => ({
        observation,
        counts: counts.map(({action, n}) => ({action, n})),
      })),
    },
  };
}
