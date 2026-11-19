export const designs = {
  'locksmith-3': {detours: [1, 4, 2], bypasses: 1},
  'locksmith-8': {detours: [2, 7, 1, 5, 8, 2, 6, 3], bypasses: 2},
};

export function courier(detours, bypasses) {
  if (
    !Array.isArray(detours) ||
    detours.length < 1 ||
    detours.length > 32 ||
    Array.from(detours).some((n) => !Number.isInteger(n) || n < 1 || n > 12)
  )
    throw Error('provide 1–32 detour lengths, each in [1, 12]');
  if (!Number.isInteger(bypasses) || bypasses < 0 || bypasses > Math.min(detours.length, 6))
    throw Error('provide a bypass budget of 0–6, at most one per lock');
  const ordinaryLength = detours.reduce((sum, n) => sum + 2 * n + 1, 0);
  const limit = 2 * ordinaryLength + 3;
  const delivery = limit + 1;
  const states = [];
  const pending = [];
  const ids = new Map();
  const add = (s) => {
    const key = s[0] === detours.length ? 'delivered' : s.join('/');
    if (!ids.has(key)) {
      ids.set(key, states.length);
      states.push({id: states.length, actions: []});
      pending.push(s);
    }
    return ids.get(key);
  };
  const initial = [{to: add([0, 0, 0, bypasses]), weight: 1}];
  for (let src = 0; src < pending.length; src++) {
    const [station, position, key, charges] = pending[src];
    if (station === detours.length) continue;
    const actions = states[src].actions;
    function edge(id, destination) {
      const reward = destination[0] === detours.length ? delivery - 1 : -1;
      actions.push({
        id,
        outcomes: [{to: add(destination), weight: 1, reward}],
      });
    }
    if (position < detours[station])
      edge(0, [station, position + 1, key || Number(position + 1 === detours[station]), charges]);
    if (position > 0) edge(1, [station, position - 1, key, charges]);
    if (position === 0 && key) edge(2, [station + 1, 0, 0, charges]);
    if (position === 0 && charges) edge(3, [station + 1, 0, 0, charges - 1]);
  }
  // Indexed by the public observation ID; the terminal row carries no inventory.
  const locations = pending.map((s) => (s[0] === detours.length ? [s[0]] : s));
  return {limit, delivery, definition: {schema: 1, initial, states}, locations};
}
