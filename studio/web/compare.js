// The endpoint returns data only. Archive names and labels always use textContent.
const palette = [
  '#71d4bc',
  '#ff986f',
  '#b69aff',
  '#80b8ff',
  '#d6bd62',
  '#ee99c4',
  '#96c973',
  '#a2a8ee',
];
const E = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
const svg = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
// Keep the chooser, legend and exact-value table on the same run identity.
function seriesLabel(run, arm) {
  const detail =
    run.algorithm === arm && Number.isInteger(run.seed) && Number.isInteger(run.episodes)
      ? run.episodes + ' episodes · seed ' + run.seed
      : arm;
  return run.name + ' · ' + detail + ' · ' + run.id.slice(-8);
}
export function comparisonGroups(results, selected) {
  const groups = new Map(),
    errors = [];
  for (const r of results) {
    if (r.error) {
      errors.push(r.name + ': ' + r.error);
      continue;
    }
    for (const s of r.data.series) {
      if (!selected.has(JSON.stringify([r.id, s.arm]))) continue;
      const key = JSON.stringify([s.game, s.gameSpecHash, r.data.budgetUnit]);
      if (!groups.has(key))
        groups.set(key, {
          game: s.game,
          gameSpecHash: s.gameSpecHash,
          unit: r.data.budgetUnit,
          lines: [],
        });
      groups.get(key).lines.push({label: seriesLabel(r, s.arm), points: s.points});
    }
  }
  return {groups: [...groups.values()], errors};
}
const plotLeft = 56,
  plotRight = 638;
export function comparisonBudgetTicks(budgets) {
  const values = [...new Set([0, ...budgets])].sort((a, b) => a - b);
  const max = values.at(-1),
    x = (v) => plotLeft + ((plotRight - plotLeft) * v) / (max || 1);
  // Keep both ends and place intermediate labels only where adjacent labels can fit.
  const gap = (a, b) => 14 + 4 * (String(a).length + String(b).length);
  const chosen = [0];
  for (const v of values.slice(1, -1)) {
    const previous = chosen.at(-1);
    if (x(v) - x(previous) >= gap(previous, v) && x(max) - x(v) >= gap(v, max)) chosen.push(v);
  }
  if (max) chosen.push(max);
  return chosen.map((value) => ({value, x: x(value)}));
}
function chart({game, gameSpecHash, unit, lines}) {
  const box = E('section');
  box.append(E('h4', game + ' · ' + unit + ' · ' + gameSpecHash.slice(0, 8)));
  const graphic = svg('svg', {
    viewBox: '0 0 680 220',
    role: 'img',
    'aria-label': game + ' validation mean return by ' + unit,
  });
  const points = lines.flatMap((l) => l.points);
  const ticks = comparisonBudgetTicks(points.map((p) => p.budget));
  const maxX = ticks.at(-1).value || 1,
    low = Math.min(...points.map((p) => p.interval?.[0] ?? p.mean)),
    high = Math.max(...points.map((p) => p.interval?.[1] ?? p.mean));
  const x = (v) => plotLeft + ((plotRight - plotLeft) * v) / maxX,
    y = (v) => (high === low ? 102 : 178 - (146 * (v - low)) / (high - low));
  for (const [a, b, c, d] of [
    [plotLeft, 28, plotLeft, 178],
    [plotLeft, 178, plotRight, 178],
  ])
    graphic.append(svg('line', {x1: a, y1: b, x2: c, y2: d, stroke: 'currentColor'}));
  const tag = (a, b, t, anchor = 'start') => {
    const e = svg('text', {
      x: a,
      y: b,
      fill: 'currentColor',
      'font-size': 12,
      'text-anchor': anchor,
    });
    e.textContent = t;
    graphic.append(e);
  };
  tag(plotLeft, 16, 'Validation mean episode return');
  const levels = high === low ? [low] : [low, (low + high) / 2, high];
  for (const level of levels) {
    const py = y(level);
    graphic.append(
      svg('line', {
        x1: plotLeft - 4,
        y1: py,
        x2: plotRight,
        y2: py,
        stroke: 'currentColor',
        opacity: 0.22,
      }),
    );
    tag(plotLeft - 7, py + 4, Number(level.toPrecision(3)), 'end');
  }
  for (const tick of ticks) {
    graphic.append(
      svg('line', {
        x1: tick.x,
        y1: 178,
        x2: tick.x,
        y2: 183,
        stroke: 'currentColor',
      }),
    );
    tag(tick.x, 199, tick.value, 'middle');
  }
  tag((plotLeft + plotRight) / 2, 216, 'Training budget (' + unit + ')', 'middle');
  const legend = E('ul');
  for (const [i, l] of lines.entries()) {
    const color = palette[i % palette.length],
      pts = l.points;
    if (pts.every((p) => p.interval)) {
      const poly = [
        ...pts.map((p) => [x(p.budget), y(p.interval[1])]),
        ...[...pts].reverse().map((p) => [x(p.budget), y(p.interval[0])]),
      ];
      graphic.append(
        svg('polygon', {
          points: poly.map((v) => v.join(',')).join(' '),
          fill: color,
          opacity: 0.16,
        }),
      );
    }
    graphic.append(
      svg('polyline', {
        points: pts.map((p) => x(p.budget) + ',' + y(p.mean)).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': 2,
      }),
    );
    for (const p of pts)
      graphic.append(svg('circle', {cx: x(p.budget), cy: y(p.mean), r: 3, fill: color}));
    const el = E('li', l.label + ' · ' + pts[0].replicates + ' replicate(s)');
    el.style.borderLeft = '4px solid ' + color;
    legend.append(el);
  }
  box.append(graphic, legend);
  const details = E('details');
  details.append(E('summary', 'Exact validation points'));
  const table = E('table'),
    head = E('tr');
  for (const title of ['Run / arm', 'Budget', 'Mean', '95% interval']) head.append(E('th', title));
  table.append(head);
  for (const line of lines)
    for (const p of line.points) {
      const row = E('tr');
      for (const val of [
        line.label,
        p.budget,
        p.mean,
        p.interval ? p.interval.join(' to ') : 'Unavailable',
      ])
        row.append(E('td', String(val)));
      table.append(row);
    }
  details.append(table);
  box.append(details);
  return box;
}
export function comparisonUI(container, api) {
  const selected = new Set(),
    form = E('fieldset'),
    legend = E('legend', 'Runs and agents'),
    go = E('button', 'Compare validation'),
    output = E('div');
  const limit = 8;
  let runs = [],
    generation = 0,
    lastList;
  output.setAttribute('aria-live', 'polite');
  go.className = 'secondary';
  go.disabled = true;
  form.append(legend);
  container.append(form, go, output);
  go.onclick = async () => {
    const epoch = ++generation;
    go.disabled = true;
    output.replaceChildren(E('p', 'Reading validation checkpoints…'));
    const chosen = runs.filter((r) => r.arms.some((a) => selected.has(JSON.stringify([r.id, a]))));
    const results = [];
    // Do not compete with our own selection for the server's bounded readers.
    for (const r of chosen) {
      if (epoch !== generation) return;
      try {
        results.push({...r, data: await api('/api/runs/' + r.id + '/summary')});
      } catch (err) {
        results.push({...r, error: err.message});
      }
    }
    if (epoch !== generation) return;
    const {groups, errors} = comparisonGroups(results, selected);
    output.replaceChildren(...errors.map((e) => E('p', 'Skipped ' + e)), ...groups.map(chart));
    go.disabled = !selected.size;
  };
  return (all) => {
    runs = all.filter((r) => r.status === 'ready');
    const list = JSON.stringify(
      runs.map((r) => [r.id, r.name, r.arms, r.algorithm, r.seed, r.episodes]),
    );
    if (list === lastList) return;
    lastList = list;
    const valid = new Set(runs.flatMap((r) => r.arms.map((a) => JSON.stringify([r.id, a]))));
    const before = selected.size;
    for (const k of selected) if (!valid.has(k)) selected.delete(k);
    if (selected.size !== before) {
      // A result (or pending read) for a removed selection no longer represents the chooser.
      generation++;
      output.replaceChildren();
      go.disabled = !selected.size;
    }
    const focused = form.contains(document.activeElement) ? document.activeElement.value : null;
    const entries = [];
    let nextFocus;
    for (const r of runs)
      for (const a of r.arms) {
        const k = JSON.stringify([r.id, a]),
          label = E('label'),
          input = E('input');
        input.type = 'checkbox';
        input.value = k;
        input.checked = selected.has(k);
        if (k === focused) nextFocus = input;
        input.onchange = () => {
          generation++;
          if (input.checked && selected.size >= limit) {
            input.checked = false;
            output.replaceChildren(E('p', 'Compare at most eight series selections.'));
          } else {
            if (input.checked) selected.add(k);
            else selected.delete(k);
            output.replaceChildren();
          }
          go.disabled = !selected.size;
        };
        label.append(input, document.createTextNode(' ' + seriesLabel(r, a)));
        entries.push(label);
      }
    form.replaceChildren(
      legend,
      ...(entries.length ? entries : [E('p', 'No ready runs to compare.')]),
    );
    nextFocus?.focus({preventScroll: true});
  };
}
