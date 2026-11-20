import {drawKart, kartActions} from './kart-scene.js';
const TAU = Math.PI * 2;
const colors = {
  ink: '#141521',
  light: '#f9e6c9',
  mint: '#72d6c3',
  coral: '#ff896c',
  muted: '#9a91b0',
};
const labels = {
  mountain_car: ['Push left', 'Coast', 'Push right'],
  cartpole: ['Push left', 'Push right'],
  acrobot: ['Torque −1', 'No torque', 'Torque +1'],
  cliff: {10: 'West', 20: 'East', 30: 'North', 40: 'South'},
};
export const gameName = (id) =>
  ({
    mountain_car: 'Mountain Car',
    cartpole: 'CartPole',
    acrobot: 'Acrobot',
    cliff: 'Cliff Walk',
    'tic-tac-toe': 'Tic-Tac-Toe',
    'raw-board': 'Tic-Tac-Toe',
    takeaway: 'Takeaway',
  })[id] ?? id;
export const replayChoice = (available, previous) =>
  available.includes(previous) ? previous : (available[0] ?? '');
// Keep matched evaluation episodes when moving among archived checkpoints.
export function replaySelection(run, checkpoint, phase, episode) {
  const phases = [];
  if (run.test && Number(checkpoint) === run.checkpoints.at(-1)) phases.push('test');
  if (run.validation) phases.push('validation');
  phase = replayChoice(phases, phase);
  const max = run[phase] ?? 0,
    n = Number(episode);
  return {
    phases,
    phase,
    max,
    episode: max ? Math.min(max, Math.max(1, Number.isSafeInteger(n) ? n : 1)) : '',
  };
}
const courierActions = ['Toward key', 'Back toward door', 'Use key', 'Spend bypass'];
export function actionName(game, id, layout) {
  if (id === undefined) return '—';
  if (layout?.renderer === 'apex-kart') return kartActions[id] ?? String(id);
  if (layout?.renderer === 'courier') return courierActions[id] ?? String(id);
  return labels[game]?.[id] ?? (isBoard(game) ? 'Place mark' : String(id));
}
const isBoard = (g) => g === 'tic-tac-toe' || g === 'raw-board';
export const tickRate = (g) => (['mountain_car', 'cartpole', 'acrobot'].includes(g) ? 24 : 2);
function rotate(i) {
  return 3 * (i % 3) + 2 - Math.floor(i / 3);
}
function square(i, pose) {
  if (pose >= 4) i = 3 * Math.floor(i / 3) + 2 - (i % 3);
  for (let j = 0; j < pose % 4; j++) i = rotate(i);
  return i;
}
function bits(mask, pose) {
  let x = 0;
  for (let i = 0; i < 9; i++) if (mask & (1 << i)) x |= 1 << square(i, pose);
  return x;
}
export function boardStates(trace) {
  const out = [[0, 0]];
  let x = 0,
    o = 0;
  for (const f of trace.frames) {
    const second = f.observation.second;
    let pose = 0;
    if (trace.symmetry ?? trace.game === 'tic-tac-toe') {
      let best = Infinity;
      for (let p = 0; p < 8; p++) {
        const k = bits(second ? o : x, p) * 512 + bits(second ? x : o, p);
        if (k < best) {
          best = k;
          pose = p;
        }
      }
    }
    if (f.accepted) {
      let i = 0;
      while (i < 9 && square(i, pose) !== f.action) i++;
      if (i < 9) {
        if (second) o |= 1 << i;
        else x |= 1 << i;
      }
    }
    out.push([x, o]);
  }
  return out;
}
export function cumulativeReturns(frames) {
  const totals = [0];
  for (const frame of frames) {
    const previous = totals.at(-1);
    totals.push(frame.accepted ? Math.fround(previous + frame.reward) : previous);
  }
  return totals;
}

export function observation(t, i) {
  if (!t?.frames?.length) return null;
  if (i === 0) return t.frames[0].observation;
  const f = t.frames[Math.min(i, t.frames.length) - 1];
  return f.nextObservation ?? f.observation;
}
function fill(c, col, x, y, w, h) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function line(c, col, x, y, u, v, w = 1) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(u, v);
  c.stroke();
}
function sky(c) {
  const g = c.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, '#242038');
  g.addColorStop(0.56, '#59405d');
  g.addColorStop(1, '#a36370');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 220);
  for (let i = 0; i < 103; i++) {
    const x = (i * 191 + 17) % 509,
      y = (i * i * 19 + i * 17 + 3) % 130;
    fill(c, i % 5 ? '#9d839b' : '#ead6ba', x, y, i % 7 ? 1 : 2, 1);
  }
}
function ridge(c, points, shade, edge) {
  for (let x = 0; x < 512; x += 2) {
    let i = 1;
    while (i < points.length - 1 && x > points[i][0]) i++;
    const [a, b] = points[i - 1],
      [d, e] = points[i];
    const y = Math.round((b + ((e - b) * (x - a)) / (d - a)) / 2) * 2;
    fill(c, shade, x, y, 2, 220 - y);
    if (edge) fill(c, edge, x, y, 2, 1);
  }
}
function sun(c, cx, cy, r) {
  for (let dy = -r; dy <= r; dy += 2) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy));
    if (dy > 2 && (dy + 2) % 8 === 0) continue;
    fill(c, dy < -8 ? '#f4c294' : dy < 6 ? '#edaa8e' : '#d68b89', cx - w, cy + dy, 2 * w, 2);
  }
}
const terrain = (x) => 130 - 31 * Math.sin(3 * x);
const worldX = (p) => 22 + ((p + 1.2) / 1.8) * 468;
function car(c, x, y, angle) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  fill(c, '#251d32', -11, -5, 22, 6);
  fill(c, '#da795c', -9, -7, 17, 5);
  fill(c, '#ffc48a', -10, -6, 20, 3);
  fill(c, '#faad71', -4, -11, 9, 5);
  fill(c, '#71495a', -2, -10, 5, 3);
  fill(c, '#ffe8ae', 7, -5, 3, 2);
  for (const k of [-6, 6]) {
    fill(c, '#201d2b', k - 3, -2, 6, 5);
    fill(c, '#9d889b', k - 1, -1, 2, 2);
  }
  c.restore();
}
function mountain(c, s) {
  sky(c);
  sun(c, 397, 63, 25);
  ridge(
    c,
    [
      [-4, 105],
      [35, 90],
      [64, 107],
      [113, 64],
      [138, 81],
      [163, 61],
      [194, 89],
      [225, 73],
      [258, 98],
      [301, 67],
      [327, 48],
      [354, 75],
      [375, 58],
      [420, 94],
      [459, 56],
      [490, 78],
      [514, 65],
    ],
    '#64506d',
    '#89667b',
  );
  ridge(
    c,
    [
      [-3, 119],
      [30, 98],
      [61, 107],
      [92, 85],
      [129, 111],
      [150, 98],
      [183, 124],
      [210, 102],
      [242, 119],
      [261, 93],
      [304, 110],
      [334, 86],
      [365, 103],
      [390, 88],
      [432, 115],
      [469, 80],
      [515, 106],
    ],
    '#493e57',
    '#71546a',
  );
  ridge(
    c,
    [
      [-2, 129],
      [31, 115],
      [60, 124],
      [98, 105],
      [148, 132],
      [189, 115],
      [235, 139],
      [281, 108],
      [313, 119],
      [347, 104],
      [385, 124],
      [426, 103],
      [463, 117],
      [513, 103],
    ],
    '#383246',
  );
  for (let x = 0; x < 512; x += 2) {
    const val = ((x - 22) / 468) * 1.8 - 1.2,
      y = terrain(val);
    fill(c, '#262636', x, y, 2, 220 - y);
    fill(c, '#bf846e', x, y, 2, 2);
    fill(c, '#594552', x, y + 2, 2, 2);
  }
  for (let i = 0; i < 1380; i++) {
    const x = (i * 107 + 7) % 512,
      y = 110 + ((i * i * 13 + i * 29) % 109);
    if (y > terrain(((x - 22) / 468) * 1.8 - 1.2) + 8)
      fill(c, i % 9 ? '#2e2c3d' : '#433645', x, y, i % 5 === 0 ? 2 : 1, 1);
  }
  const fx = worldX(0.5),
    fy = terrain(0.5);
  fill(c, '#e0ba9a', fx, fy - 25, 1, 25);
  for (let j = 0; j < 8; j++) fill(c, '#81d7bf', fx + 1, fy - 25 + j, 10 - j, 1);
  const p = s?.position ?? -0.48;
  car(c, worldX(p), terrain(p) - 3, Math.atan((-93 * Math.cos(3 * p) * 1.8) / 468));
}
function grid(c) {
  fill(c, '#1c1d2a', 0, 0, 512, 220);
  for (let x = 0; x < 512; x += 16)
    for (let y = 0; y < 220; y += 16) fill(c, '#343343', x, y, 1, 1);
}
function pole(c, s) {
  grid(c);
  const x = 256 + (s?.x ?? 0) * 58,
    y = 148,
    theta = s?.angle ?? 0.07;
  for (let i = 0; i < 512; i += 10) {
    fill(c, '#534657', i, 167, 4, 3);
    fill(c, '#383544', i - 4, 170, 9, 2);
  }
  fill(c, '#888596', 0, 160, 512, 2);
  for (let i = 0; i < 2; i++) {
    const k = x + (i ? 12 : -12);
    fill(c, '#100f1a', k - 5, 151, 10, 9);
    fill(c, '#a3a4ad', k - 2, 153, 4, 4);
  }
  fill(c, '#e58d78', x - 23, y - 8, 46, 13);
  fill(c, '#ffbaa1', x - 23, y - 8, 46, 3);
  const tx = x + 66 * Math.sin(theta),
    ty = y - 66 * Math.cos(theta);
  line(c, '#362c3a', x + 2, y, tx + 2, ty, 7);
  line(c, '#b4ddc8', x, y, tx, ty, 4);
  fill(c, '#f0d8b5', x - 3, y - 3, 6, 6);
}
function flag(c, x, y) {
  fill(c, '#eadfc2', x, y - 12, 1, 12);
  for (let j = 0; j < 6; j++) fill(c, colors.mint, x + 1, y - 12 + j, 7 - j, 1);
}
function cliff(c, s) {
  grid(c);
  const cell = 39,
    left = 158,
    top = 51;
  for (let n = 0; n < 15; n++) {
    const x = left + (n % 5) * cell,
      y = top + Math.floor(n / 5) * cell;
    const hazard = n > 10 && n < 14;
    fill(c, hazard ? '#4b3440' : '#333342', x + 1, y + 1, cell - 2, cell - 2);
    if (hazard)
      for (let j = 0; j < 3; j++)
        line(c, '#98635d', x + 7 + j * 9, y + 25, x + 12 + j * 9, y + 16, 2);
    if (n === 14) flag(c, x + 19, y + 26);
  }
  const n = Number.isInteger(s) ? s : 10,
    x = left + (n % 5) * cell + 19,
    y = top + Math.floor(n / 5) * cell + 19;
  fill(c, '#66414a', x - 9, y - 7, 18, 16);
  fill(c, colors.coral, x - 7, y - 9, 14, 15);
  fill(c, '#ffd9b3', x - 4, y - 6, 8, 3);
  fill(c, '#312732', x - 5, y + 6, 3, 4);
  fill(c, '#312732', x + 2, y + 6, 3, 4);
}
function board(c, state) {
  grid(c);
  const bx = 187,
    by = 41,
    cell = 46;
  for (let j = 1; j < 3; j++) {
    line(c, '#706072', bx + j * cell, by, bx + j * cell, by + 3 * cell, 2);
    line(c, '#706072', bx, by + j * cell, bx + 3 * cell, by + j * cell, 2);
  }
  for (let i = 0; i < 9; i++) {
    const x = bx + ((i % 3) + 0.5) * cell,
      y = by + (Math.floor(i / 3) + 0.5) * cell;
    if (state[0] & (1 << i)) {
      line(c, colors.coral, x - 10, y - 10, x + 10, y + 10, 4);
      line(c, colors.coral, x + 10, y - 10, x - 10, y + 10, 4);
    } else if (state[1] & (1 << i)) {
      c.beginPath();
      c.strokeStyle = colors.mint;
      c.lineWidth = 4;
      c.arc(x, y, 12, 0, TAU);
      c.stroke();
    }
  }
}
// Angles are measured from the downward vertical. The second link's
// absolute angle is the sum of both public joint angles.
export function acrobotPose(observation) {
  const {theta1 = 0, theta2 = 0} = observation ?? {};
  const joint = [Math.sin(theta1), Math.cos(theta1)];
  const tip = [joint[0] + Math.sin(theta1 + theta2), joint[1] + Math.cos(theta1 + theta2)];
  return {joint, tip, reached: tip[1] < -1};
}
function acrobot(canvas, observation) {
  const {joint, tip, reached} = acrobotPose(observation);
  const x = 256,
    y = 113,
    size = 44;
  const [jx, jy] = joint.map((value, i) => (i ? y : x) + value * size);
  const [tx, ty] = tip.map((value, i) => (i ? y : x) + value * size);
  grid(canvas);
  canvas.save();
  canvas.setLineDash([5, 5]);
  line(canvas, reached ? colors.mint : colors.muted, 70, y - size, 442, y - size, 1);
  canvas.restore();
  canvas.fillStyle = colors.light;
  canvas.font = '10px monospace';
  canvas.textAlign = 'left';
  canvas.fillText('Target height', 74, y - size - 8);
  line(canvas, colors.light, x, y, jx, jy, 6);
  line(canvas, colors.mint, jx, jy, tx, ty, 6);
  for (const [cx, cy, color] of [
    [x, y, colors.coral],
    [jx, jy, colors.light],
    [tx, ty, colors.mint],
  ]) {
    canvas.beginPath();
    canvas.fillStyle = color;
    canvas.arc(cx, cy, 5, 0, TAU);
    canvas.fill();
  }
}
function unknown(c, s) {
  grid(c);
  c.fillStyle = colors.light;
  c.textAlign = 'center';
  c.font = '9px monospace';
  c.fillText('PUBLIC OBSERVATION', 256, 88);
  let txt = JSON.stringify(s) ?? 'No moves';
  for (let i = 0; i < Math.min(5, Math.ceil(txt.length / 60)); i++)
    c.fillText(txt.slice(i * 60, i * 60 + 60), 256, 108 + i * 13);
}
export function courierCaption(layout, obs) {
  const location = layout?.renderer === 'courier' ? layout.locations?.[obs] : undefined;
  if (!location) return undefined;
  const [station, position, key, charges] = location;
  if (station === layout.detours.length) return 'Delivered. All doors passed.';
  return (
    'Door ' +
    (station + 1) +
    ' of ' +
    layout.detours.length +
    '. ' +
    (position === 0
      ? 'At the door.'
      : 'Corridor position ' + position + ' of ' + layout.detours[station] + '.') +
    ' ' +
    (key ? 'Key in hand.' : 'Key at corridor end.') +
    ' ' +
    charges +
    (charges === 1 ? ' bypass charge left.' : ' bypass charges left.')
  );
}
function drawCourier(c, layout, location) {
  grid(c);
  const [station, position, key, charges] = location;
  const n = layout.detours.length,
    delivered = station === n;
  function text(value, x, y, color = colors.light, size = 17) {
    c.textAlign = 'center';
    c.fillStyle = color;
    c.font = 'bold ' + size + 'px sans-serif';
    c.fillText(value, x, y);
  }
  const span = Math.min(54, 448 / n);
  for (let i = 0; i < n; i++) {
    const x = 256 + (i - (n - 1) / 2) * span;
    const shade = i < station ? colors.mint : i === station ? colors.coral : colors.muted;
    line(c, shade, x - span / 2 + 3, 67, x + span / 2 - 3, 67, 5);
    text(i + 1, x, 61, shade, 16);
  }
  if (delivered) {
    text('DELIVERED', 256, 131, colors.mint, 30);
    text('All ' + n + ' doors passed', 256, 163);
    return;
  }
  text('DOOR ' + (station + 1) + ' OF ' + n, 256, 100, colors.light, 20);
  const left = 60,
    right = 452,
    depth = layout.detours[station],
    y = 142;
  const x = (p) => left + (p * (right - left)) / depth;
  line(c, colors.muted, left, y, right, y, 3);
  for (let p = 0; p <= depth; p++) fill(c, colors.light, x(p) - 1, y - 5, 3, 10);
  fill(c, key ? colors.mint : colors.coral, left - 21, y - 18, 8, 36);
  c.beginPath();
  c.arc(x(position), y, 9, 0, TAU);
  c.fillStyle = colors.mint;
  c.fill();
  text('Door', left, 173, colors.light, 16);
  text(key ? 'Key taken' : 'Key', right, 173, colors.light, 16);
  text(
    (key ? 'Key in hand' : 'Key not collected') +
      '  ·  ' +
      charges +
      '/' +
      layout.bypasses +
      ' bypass charges',
    256,
    203,
  );
}
export function gridMarkers(layout, obs) {
  if (!Number.isInteger(obs) || obs < 0) return [];
  if (layout.decoder === 'taxi') {
    if (obs >= 500) return [];
    const depots = {};
    layout.rows.forEach((row, y) =>
      [...row].forEach((cell, x) => {
        if ('RGYB'.includes(cell)) depots[cell] = [y, x];
      }),
    );
    const stops = 'RGYB';
    const passenger = Math.floor(obs / 4) % 5,
      dest = stops[obs % 4];
    const taxi = Math.floor(obs / 20);
    return [
      [...depots[dest], 'destination'],
      ...(passenger < 4 ? [[...depots[stops[passenger]], 'passenger']] : []),
      [Math.floor(taxi / 5), taxi % 5, passenger === 4 ? 'occupied' : 'taxi'],
    ];
  }
  if (layout.points) return layout.points[obs] ?? [];
  const width = layout.rows[0].length;
  return obs < layout.rows.length * width ? [[Math.floor(obs / width), obs % width, 'agent']] : [];
}
function drawFiniteGrid(c, layout, obs) {
  const rows = layout.rows,
    width = rows[0].length;
  const size = Math.min(474 / width, 182 / rows.length);
  const left = (512 - width * size) / 2,
    top = (220 - rows.length * size) / 2;
  grid(c);
  const palette = {
    '.': '#163941',
    S: '#255663',
    P: '#813a53',
    '#': '#101b21',
    R: '#913e51',
    G: '#2a8c67',
    Y: '#93702e',
    B: '#36588e',
  };
  rows.forEach((row, y) =>
    [...row].forEach((kind, x) => {
      fill(
        c,
        palette[kind] ?? palette['.'],
        left + x * size,
        top + y * size,
        Math.max(1, size - 1),
        Math.max(1, size - 1),
      );
      if (size >= 13 && kind !== '.' && kind !== '#') {
        c.fillStyle = '#edfaff';
        c.font = Math.min(size * 0.34, 13) + 'px monospace';
        c.textAlign = 'left';
        c.fillText(kind, left + (x + 0.11) * size, top + (y + 0.35) * size);
      }
    }),
  );
  for (const [y, x] of layout.verticalWalls ?? [])
    line(
      c,
      '#edfaff',
      left + (x + 1) * size,
      top + y * size,
      left + (x + 1) * size,
      top + (y + 1) * size,
      2,
    );
  const markers = {
    agent: ['#9ef8d3', '●'],
    ball: ['#ffe783', '●'],
    paddle: ['#78e0ef', '▰'],
    destination: ['#ffffff', '□'],
    passenger: ['#ffffff', '◇'],
    taxi: ['#ffe783', '●'],
    occupied: ['#ffe783', '◆'],
  };
  for (const [y, x, mark] of gridMarkers(layout, obs)) {
    if (!rows[y] || x < 0 || x >= width || !markers[mark]) continue;
    const [color, glyph] = markers[mark];
    c.fillStyle = color;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font =
      Math.max(3, size * (mark === 'destination' || mark === 'passenger' ? 0.88 : 0.58)) +
      'px sans-serif';
    c.fillText(glyph, left + (x + 0.55) * size, top + (y + 0.58) * size);
  }
}
export function draw(canvas, game, obs, boardState, layout, {kartDashboard = true} = {}) {
  const c = canvas.getContext('2d');
  c.save();
  c.setTransform(canvas.width / 512, 0, 0, canvas.height / 220, 0, 0);
  c.imageSmoothingEnabled = false;
  if (layout?.renderer === 'apex-kart') {
    if (!drawKart(c, layout, obs, kartDashboard)) unknown(c, obs);
  } else if (layout?.renderer === 'courier' && layout.locations?.[obs])
    drawCourier(c, layout, layout.locations[obs]);
  else if (layout?.rows?.[0]?.length) drawFiniteGrid(c, layout, obs);
  else if (game === 'mountain_car') mountain(c, obs);
  else if (game === 'cartpole') pole(c, obs);
  else if (game === 'acrobot') acrobot(c, obs);
  else if (game === 'cliff') cliff(c, obs);
  else if (isBoard(game)) board(c, boardState ?? [17, 66]);
  else unknown(c, obs);
  c.restore();
}
export function channels(game) {
  return game === 'mountain_car'
    ? [
        ['Position', 'position'],
        ['Velocity', 'velocity'],
      ]
    : game === 'cartpole'
      ? [
          ['Cart position', 'x'],
          ['Pole angle', 'angle'],
        ]
      : game === 'acrobot'
        ? [
            ['Base angle', 'theta1'],
            ['Elbow angle', 'theta2'],
          ]
        : [
            ['Reward', 'reward'],
            ['Episode return', 'total'],
          ];
}
