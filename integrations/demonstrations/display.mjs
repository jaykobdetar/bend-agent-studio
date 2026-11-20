// Display metadata can interpret only the public observation and action IDs.
// Never use private world-state IDs, transitions, or a reference policy.
const directions = ['up', 'right', 'down', 'left'];
const kartActions = ['coast', 'throttle', 'brake', 'steer left', 'steer right'];
const corners = {l: 'left sweeper', r: 'right sweeper', L: 'left hairpin', R: 'right hairpin'};
export const isKart = (layout) =>
  layout?.renderer === 'apex-kart' && typeof layout.road === 'string';

function labels(world, layout) {
  return world.grid ? directions : isKart(layout) ? kartActions : [];
}

export function actionText(world, layout, action) {
  const name = labels(world, layout)[action];
  return name ? action + ' ' + name : String(action);
}

export function actionInput(world, layout, legal, text) {
  if (/^(0|[1-9][0-9]*)$/.test(text)) return Number(text);
  const names = labels(world, layout);
  const words = text.replace(/\s+/g, ' ');
  return legal.find(
    (a) => names[a] && (names[a] === words || names[a].replace(/^steer /, '') === words),
  );
}

export function display(world, layout, view) {
  const {observation, legal} = view;
  const lines = [];
  if (world.grid) {
    const w = world.grid[0].length;
    const y = Math.floor(observation / w),
      x = observation % w;
    // Small scroll window even for large grids.
    const top = Math.max(0, y - 5),
      left = Math.max(0, x - 15);
    lines.push(
      ...world.grid.slice(top, top + 11).map((row, i) => {
        const chars = [...row.slice(left, left + 31)];
        if (i + top === y) chars[x - left] = '@';
        return chars.join('');
      }),
    );
    lines.push('@ you  G goal  P pit  # wall');
  } else if (isKart(layout)) {
    if (observation === 0) lines.push(layout.title + ': finish line crossed');
    else {
      const n = observation - 1,
        d = Math.floor(n / 9);
      const lane = ['left', 'center', 'right'][Math.floor(n / 3) % 3];
      const remaining = layout.road.slice(d);
      const next = remaining.search(/[lr]/i);
      const advice =
        next < 0
          ? 'straight to the finish'
          : corners[remaining[next]] +
            (next === 0
              ? ' on the next cell'
              : ' after ' + next + ' straight ' + (next === 1 ? 'cell' : 'cells'));
      lines.push(
        layout.title +
          ': ' +
          d +
          '/' +
          layout.road.length +
          ' cells | lane ' +
          lane +
          ' | speed ' +
          ((n % 3) + 1) +
          '/3',
        'Next track: ' + remaining.slice(0, 8) + '   (' + advice + ')',
      );
    }
  } else lines.push('Observation ' + observation);
  if (legal.length)
    lines.push('Actions: ' + legal.map((a) => actionText(world, layout, a)).join(' | '));
  return lines.join('\n');
}
