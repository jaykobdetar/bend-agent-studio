// A deadline, a changing market, and a finite store of energy. A state includes
// the public clock: an agent never needs to guess how many decisions remain.
export const BID = [1, 4, 9];
export const WEATHER = [[5, 2, 1], [2, 4, 2], [1, 3, 4]];
export const variants = [[2, 2], [12, 4]]; // [number of trading periods, storage capacity]

function checkSize(periods, capacity) {
  if (!Number.isInteger(periods) || periods < 1 || periods > 96)
    throw Error('periods must be an integer from 1 to 96');
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 24)
    throw Error('capacity must be an integer from 2 to 24');
}

export function stormReserve(periods, capacity) {
  checkSize(periods, capacity);
  const reserve = Math.floor(capacity / 2);
  const rows = [null, [0, reserve, 0]]; // terminal, then opening at calm weather
  const layers = [[1]];
  // Only feasible combinations enter the model. Keep IDs dense for the packed backend.
  for (let t = 1; t < periods; ++t) {
    const layer = [];
    for (let charge = Math.max(0, reserve - t); charge <= Math.min(capacity, reserve + t); ++charge)
      for (let weather = 0; weather < 3; ++weather) {
        layer.push(rows.length);
        rows.push([t, charge, weather]);
      }
    layers.push(layer);
  }
  const states = rows.map((row, id) => {
    if (!row) return {id, actions: []};
    const [t, q, w] = row;
    const actions = [];
    for (const [action, delta, cash] of [[0, 0, 0], [1, 1, -BID[w]-1], [2, -1, BID[w]]]) {
      const next = q + delta;
      if (next < 0 || next > capacity) continue;
      let outcomes;
      if (t + 1 === periods) {
        const settlement = next < reserve ? 7 * (next - reserve) : next - reserve;
        outcomes = [{to: 0, weight: 1, reward: cash + settlement}];
      } else {
        const offset = 3 * (next - Math.max(0, reserve - t - 1));
        outcomes = WEATHER[w].map((weight, k) => ({to: layers[t + 1][offset + k], weight, reward: cash}));
      }
      actions.push({id: action, outcomes});
    }
    return {id, actions};
  });
  return {definition: {schema: 1, initial: [{to: 1, weight: 1}], states}, rows, reserve};
}

// Solve the physical inventory problem without reading generated state IDs,
// outcomes or reset tables. One backwards pass computes a long-horizon oracle
// and the return of a myopic controller that settles as if each step were last.
export function reference(periods, capacity) {
  checkSize(periods, capacity);
  const reserve = Math.floor(capacity / 2);
  const settle = q => Math.min(q - reserve, 0) * 7 + Math.max(q - reserve, 0);
  let values = Array.from({length: capacity + 1}, (_, q) => BID.map(() => [settle(q), settle(q)]));
  for (let left = 1; left <= periods; ++left) {
    const old = values;
    values = old.map((_, q) => BID.map((price, weather) => {
      let opt = -Infinity, greedy = -Infinity, greedyValue = 0;
      // Same specified tie rule as the documentation: hold, charge, discharge.
      for (const change of [0, 1, -1]) {
        const after = q + change;
        if (after > capacity || after < 0) continue;
        const cash = -change * (price + (change > 0 ? 1 : 0));
        const [v, g] = [0, 1].map(i => old[after].reduce(
          (acc, pair, j) => acc + WEATHER[weather][j] / 8 * pair[i], cash));
        opt = Math.max(opt, v);
        if (cash + settle(after) > greedy) {
          greedy = cash + settle(after);
          greedyValue = g;
        }
      }
      return [opt, greedyValue];
    }));
  }
  const [optimal, myopic] = values[reserve][0];
  return {optimal, myopic, noTrade: 0};
}
