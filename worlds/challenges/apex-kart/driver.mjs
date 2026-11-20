import {decode} from './kart.mjs';

// A scripted reference, not the learner or the oracle. It sees just the public
// dashboard and fixed map. Read the next corner, not all possible future moves.
export function scriptedInput(road, obs) {
  const {distance, lane, speed} = decode(obs);
  const ahead = road.slice(distance).search(/[lr]/i);
  if (ahead < 0 || ahead >= speed + 1) return 1;
  const tile = road[distance + ahead];
  const inside = tile.toLowerCase() === 'l' ? 0 : 2;
  const base = tile === tile.toLowerCase() ? 2 : 1;
  if (speed > base + Number(inside === lane)) return 2;
  if (lane !== inside) return lane < inside ? 4 : 3;
  return speed < base + 1 ? 1 : 0;
}
