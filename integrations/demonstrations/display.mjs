// Display metadata can interpret only the public observation and action IDs.
// Never use private world-state IDs, transitions, or a reference policy.
const directions = ['up', 'right', 'down', 'left'];
const kartActions = ['coast', 'throttle', 'brake', 'steer left', 'steer right'];
export function display(world, layout, view) {
  const {observation, legal} = view;
  const lines = ['Observation ' + observation];
  let labels = [];
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
    labels = directions;
  } else if (layout?.renderer === 'apex-kart' && typeof layout.road === 'string') {
    labels = kartActions;
    if (observation === 0) lines.push(layout.title + ': finish');
    else {
      const n = observation - 1,
        d = Math.floor(n / 9);
      const lane = ['left', 'center', 'right'][Math.floor(n / 3) % 3];
      lines.push(
        layout.title +
          ': ' +
          d +
          '/' +
          layout.road.length +
          ' | lane ' +
          lane +
          ' | speed ' +
          ((n % 3) + 1),
        'Next track: ' + layout.road.slice(d, d + 8) + '   (. straight, l/r sweep, L/R hairpin)',
      );
    }
  }
  if (legal.length)
    lines.push(
      'Actions: ' + legal.map((a) => (labels[a] ? a + ' ' + labels[a] : String(a))).join(' | '),
    );
  return lines.join('\n');
}
