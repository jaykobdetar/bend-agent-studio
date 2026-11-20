// One tick, one input. No random physics: the reset grid is the only random draw.
export const courses = {
  'kart-sprint': {title: 'Quarry Sprint', road: '...L..r..', starts: [1]},
  'kart-ridge': {title: 'Juniper Ridge', road: '....l..L...r.r..R....l.r....', starts: [0, 2]},
};
export const actionLabels = ['Coast', 'Throttle', 'Brake', 'Steer left', 'Steer right'];
const actions = [0, 1, 2, 3, 4];
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

// The public ID is stable and invertible independent of track or traversal order.
// ID 0 means finished, not a fictitious final speed or lane.
export function decode(obs) {
  if (!Number.isSafeInteger(obs) || obs < 1) return null;
  const n = obs - 1;
  return {distance: Math.floor(n / 9), lane: Math.floor(n / 3) % 3, speed: n % 3 + 1};
}
export const encode = ({distance, lane, speed}) => distance * 9 + lane * 3 + speed;

export function advance(road, state, action) {
  let {distance, lane, speed} = state;
  if (!actions.includes(action)) throw Error('unknown kart input');
  const start = distance;
  speed = clamp(speed + Number(action === 1) - Number(action === 2), 1, 3);
  lane = clamp(lane + Number(action === 4) - Number(action === 3), 0, 2);
  let gravel = false;
  // Sweep every crossed cell; reaching the finish never skips a preceding corner.
  for (let i = 0; i < speed && distance < road.length; ++i) {
    const cell = road[distance++];
    if (cell === '.') continue;
    const inside = cell.toLowerCase() === 'l' ? 0 : 2;
    const grip = cell === cell.toLowerCase() ? 2 : 1;
    if (speed <= grip) continue;
    if (speed === grip + 1 && lane === inside) lane = 1; // drift out of the apex
    else {
      gravel = true;
      speed = 1;
      lane = 2 - inside; // the run-off is on the outside
      break;
    }
  }
  return {observation: distance === road.length ? 0 : encode({distance, lane, speed}),
    distance, lane, speed, gravel, reward: distance - start - 1 - 4 * Number(gravel)};
}

export function kartWorld({road, starts}) {
  if (typeof road !== 'string' || !/^[.lrLR]{1,128}$/.test(road)) throw Error('road needs 1–128 valid cells');
  if (!Array.isArray(starts) || ![1,2].includes(starts.length) || new Set(starts).size !== starts.length ||
      !starts.every(x => [0,1,2].includes(x))) throw Error('choose one or two distinct grid lanes');
  // Dense private row IDs keep the packed backend fast; only the formula above is public.
  const states = [{id: 0, observation: 0, actions: []}], ids = new Map([[0, 0]]);
  function intern(obs) {
    if (!ids.has(obs)) {
      ids.set(obs, states.length);
      states.push({id: states.length, observation: obs, actions: []});
    }
    return ids.get(obs);
  }
  const initial = starts.map(lane => ({to: intern(encode({distance: 0, lane, speed: 1})), weight: 1}));
  for (let i = 1; i < states.length; ++i) {
    const state = states[i];
    state.actions = actions.map(id => {
      const {observation, reward} = advance(road, decode(state.observation), id);
      return {id, outcomes: [{to: intern(observation), weight: 1, reward}]};
    });
  }
  return {schema: 1, initial, states};
}
