// Display only. Draw from the public observation and the matched course;
// do not re-simulate the action or infer a hidden lane at the finish.
export const kartActions = ['Coast', 'Throttle', 'Brake', 'Steer left', 'Steer right'];
const lanes = ['Left', 'Center', 'Right'];
const turns = {l: 'Left sweeper', r: 'Right sweeper', L: 'Left hairpin', R: 'Right hairpin'};
function read(layout, obs) {
  if (
    layout?.renderer !== 'apex-kart' ||
    typeof layout.title !== 'string' ||
    typeof layout.road !== 'string' ||
    !/^[.lrLR]{1,128}$/.test(layout.road) ||
    !Number.isInteger(obs) ||
    obs < 0 ||
    obs > layout.road.length * 9
  )
    return;
  if (!obs) return {distance: layout.road.length, finish: true};
  const n = obs - 1,
    distance = Math.floor(n / 9);
  const ahead = layout.road.slice(distance).search(/[lr]/i);
  return {
    distance,
    lane: Math.floor(n / 3) % 3,
    speed: 1 + (n % 3),
    ahead,
    next: ahead < 0 ? 'Finish' : turns[layout.road[distance + ahead]],
  };
}
export function kartTelemetry(layout, obs) {
  const s = read(layout, obs);
  if (!s) return;
  const {distance} = s,
    length = layout.road.length;
  if (s.finish) {
    return {
      distance,
      length,
      lane: null,
      speed: null,
      next: 'Finish line crossed',
      caption: layout.title + ': finished all ' + distance + ' cells.',
    };
  }
  const lane = lanes[s.lane];
  const next =
    s.ahead < 0
      ? 'Straight to the finish'
      : s.next + (s.ahead === 0 ? ' now' : ' · ' + (s.ahead + 1) + ' cells ahead');
  return {
    distance,
    length,
    lane,
    speed: s.speed,
    next,
    caption:
      layout.title +
      ': ' +
      distance +
      '/' +
      length +
      ' cells. ' +
      lane +
      ' lane, speed ' +
      s.speed +
      '/3. ' +
      next.replace(' · ', ' ') +
      '.',
  };
}
export const kartCaption = (layout, obs) => kartTelemetry(layout, obs)?.caption;
function poly(c, color, points) {
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    if (i) c.lineTo(points[i], points[i + 1]);
    else c.moveTo(points[i], points[i + 1]);
  }
  c.closePath();
  c.fill();
}
function rect(c, color, x, y, w, h) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}
function label(c, text, x, y, size, color = '#fff1d8', align = 'left') {
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.font = 'bold ' + size + 'px monospace';
  c.fillText(text, x, y);
}
// The perspective road is an illustration of the known tiles ahead, not a physics input.
function landscape(c, road, s) {
  const sky = c.createLinearGradient(0, 13, 0, 91);
  sky.addColorStop(0, '#70799a');
  sky.addColorStop(0.65, '#e9ada1');
  sky.addColorStop(1, '#f7c796');
  c.fillStyle = sky;
  c.fillRect(0, 0, 512, 102);
  rect(c, '#ffdfa4', 350, 29, 24, 24);
  rect(c, '#ffdfa4', 346, 34, 33, 14);
  poly(
    c,
    '#af8d91',
    [
      0, 69, 39, 66, 73, 49, 95, 58, 135, 36, 162, 55, 192, 59, 223, 50, 249, 65, 300, 58, 342, 42,
      374, 60, 410, 49, 441, 65, 479, 57, 512, 69, 512, 98, 0, 98,
    ],
  );
  poly(
    c,
    '#64777c',
    [
      0, 75, 37, 58, 69, 71, 110, 62, 151, 76, 198, 54, 221, 62, 251, 75, 305, 69, 344, 80, 385, 68,
      417, 54, 444, 67, 479, 59, 512, 69, 512, 102, 0, 102,
    ],
  );
  poly(
    c,
    '#365c58',
    [
      0, 80, 34, 73, 77, 82, 130, 77, 170, 85, 200, 73, 257, 82, 315, 78, 379, 85, 423, 73, 465, 83,
      512, 73, 512, 102, 0, 102,
    ],
  );
  rect(c, '#49785c', 0, 88, 512, 107);
  const h = 95,
    far = 12;
  const curve = (d) => {
    let integral = 0;
    for (let i = 0; i < d; ++i) {
      const ch = road[s.distance + i];
      if (ch && ch !== '.')
        integral +=
          (ch.toLowerCase() === 'l' ? -1 : 1) * (d - i) * (ch === ch.toUpperCase() ? 1.5 : 1);
    }
    return 133 * Math.tanh(integral / 17);
  };
  const cross = (d) => {
    const z = 1 / (1 + d * 0.4),
      ratio = (z - 1 / (1 + far * 0.4)) / (1 - 1 / (1 + far * 0.4));
    return {x: 256 + curve(d), y: h + ratio * 99, w: 7 + ratio * 199};
  };
  function band(a, b, l, r, color) {
    poly(c, color, [
      a.x + a.w * l,
      a.y,
      a.x + a.w * r,
      a.y,
      b.x + b.w * r,
      b.y,
      b.x + b.w * l,
      b.y,
    ]);
  }
  for (let i = far - 1; i >= 0; --i) {
    const a = cross(i),
      b = cross(i + 1),
      odd = (s.distance + i) % 2;
    rect(c, odd ? '#588460' : '#679166', 0, b.y, 512, a.y - b.y + 0.6);
    band(a, b, -1.09, 1.09, '#c4a87f');
    band(a, b, -1.035, 1.035, odd ? '#ec9b77' : '#ffe6b6');
    band(a, b, -1, 1, odd ? '#424352' : '#494955');
    if (odd) for (const x of [-1 / 3, 1 / 3]) band(a, b, x - 0.006, x + 0.006, '#c5b9aa');
    if (s.distance + i + 1 === road.length) {
      const mid = {
        x: b.x * 0.86 + a.x * 0.14,
        y: b.y * 0.86 + a.y * 0.14,
        w: b.w * 0.86 + a.w * 0.14,
      };
      for (let j = 0; j < 12; j++)
        band(mid, b, -1 + j / 6, -1 + (j + 1) / 6, j % 2 ? '#202431' : '#fff1d8');
    }
    if ((s.distance + i) % 3 === 1 && i > 0) {
      for (const dir of [-1, 1]) {
        const x = b.x + dir * (b.w * 1.45 + 6),
          ht = 4 + b.w * 0.31;
        rect(c, '#65554c', x - ht * 0.065, b.y - ht * 0.4, ht * 0.13, ht * 0.4);
        poly(c, '#264b48', [
          x,
          b.y - ht,
          x - ht * 0.27,
          b.y - ht * 0.26,
          x + ht * 0.27,
          b.y - ht * 0.26,
        ]);
        poly(c, '#36635b', [x, b.y - ht, x - ht * 0.23, b.y - ht * 0.32, x, b.y - ht * 0.4]);
      }
    }
  }
}
function kart(c, x) {
  c.save();
  c.translate(x, 177);
  // Tire blocks, orange engine cover, roll hoop and cream helmet.
  rect(c, '#34343f', -28, 5, 56, 5);
  for (const side of [-1, 1]) {
    rect(c, '#202431', side * 21 - 6, -6, 12, 14);
    rect(c, '#5f6570', side * 21 - 5, -4, 10, 2);
    rect(c, '#21232f', side * 16 - 4, -15, 8, 9);
  }
  poly(c, '#c95945', [-21, 4, -18, -8, -11, -13, 11, -13, 18, -8, 21, 4, 16, 7, -16, 7]);
  rect(c, '#ffb077', -18, -7, 36, 4);
  rect(c, '#ef7856', -16, 0, 32, 5);
  rect(c, '#653f4b', -10, 1, 20, 3);
  rect(c, '#c2d4cb', -13, 5, 26, 2);
  rect(c, '#252d3d', -9, -16, 18, 10);
  rect(c, '#fff1d8', -7, -20, 14, 13);
  rect(c, '#fff1d8', -5, -23, 10, 4);
  rect(c, '#507f7d', -7, -17, 14, 4);
  rect(c, '#90d9c0', 2, -17, 4, 2);
  c.restore();
}
export function drawKart(c, layout, obs, dashboard = true) {
  const s = read(layout, obs);
  if (!s) return false;
  c.save();
  // The interactive viewer has real, resizable dashboard text beneath the
  // artwork. The standalone GIF still carries the screen-printed HUD.
  if (!dashboard) c.scale(1, 220 / 194);
  landscape(c, layout.road, s);
  if (!s.finish) kart(c, 256 + (s.lane - 1) * 99);
  c.restore();
  if (s.finish) {
    rect(c, '#24323e', 147, 101, 218, 46);
    label(c, 'FINISH', 256, 132, 28, '#ffe5aa', 'center');
  }
  if (!dashboard) return true;
  rect(c, '#24323e', 0, 0, 512, 22);
  rect(c, '#e59b71', 0, 20, 512, 2);
  label(c, 'APEX / ' + layout.title.toUpperCase(), 10, 15, 12);
  label(c, s.distance + ' / ' + layout.road.length + ' CELLS', 501, 15, 11, '#a4e5cd', 'right');
  rect(c, '#24323e', 0, 194, 512, 26);
  rect(c, '#65837f', 0, 194, 512, 2);
  rect(c, '#a1e5ca', 0, 194, (512 * s.distance) / layout.road.length, 2);
  if (s.finish) {
    label(c, 'TIME TRIAL COMPLETE', 256, 212, 13, '#a1e5ca', 'center');
  } else {
    label(c, 'SPEED ' + s.speed + '/3', 10, 212, 12);
    label(c, lanes[s.lane].toUpperCase() + ' LANE', 124, 212, 12, '#a4e5cd');
    label(
      c,
      s.ahead === -1 ? 'STRAIGHT TO FINISH' : s.next.toUpperCase() + ' IN ' + (s.ahead + 1),
      502,
      212,
      12,
      '#ffe5aa',
      'right',
    );
  }
  return true;
}
