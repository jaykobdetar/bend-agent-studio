import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {armHooks, readPlan, readPlanSource} from '../core/experiment.mjs';
import {numberPreservingJson, symbol} from '../core/finite_world.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (dir, file) => {
  const rel = path.relative(dir, file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
const manifestName = (name) =>
  typeof name === 'string' &&
  name.length <= 512 &&
  name.endsWith('.json') &&
  !/[\x00-\x1f\\:]/u.test(name) &&
  !name.split('/').some((p) => !p || p === '.' || p === '..');

export function manifestPicker(root) {
  const experiments = path.join(root, 'experiments');
  function load(name) {
    if (!manifestName(name)) throw Error('Choose a JSON manifest inside experiments/.');
    const checkout = fs.realpathSync(root),
      home = fs.realpathSync(experiments);
    if (!within(checkout, home) || home !== path.join(checkout, 'experiments'))
      throw Error('The experiments directory must not be a link.');
    function guard(file) {
      const real = fs.realpathSync(file);
      if (!within(checkout, real) || !fs.statSync(real).isFile())
        throw Error('Manifest sources must be files inside the checkout.');
      return real;
    }
    const file = path.join(home, name);
    if (!within(home, guard(file))) throw Error('Choose a JSON manifest inside experiments/.');
    const source = readPlanSource(file, guard),
      plan = readPlan(source),
      hooks = armHooks(plan);
    const layouts = Object.fromEntries(
      [...source.games, ...(source.evaluationGames ?? [])]
        .filter(
          (g) =>
            Array.isArray(g.definition?.grid) &&
            g.definition.grid.length * g.definition.grid[0].length <= 4096,
        )
        .map((g) => [symbol(g.definition), {rows: g.definition.grid}]),
    );
    return {
      info: {
        name: plan.name,
        file: name,
        hooks,
        games: plan.games.map((g) => g.id),
        replicates: plan.replicates,
        checkpoints: plan.checkpoints,
        budgetUnit: plan.budgetUnit,
      },
      snapshot: numberPreservingJson({source, layouts}),
    };
  }
  function list() {
    const out = [];
    function walk(dir, prefix = '') {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), name + '/');
        else if (entry.isFile() && manifestName(name)) out.push(name);
      }
    }
    if (fs.existsSync(experiments) && !fs.lstatSync(experiments).isSymbolicLink())
      walk(experiments);
    return out.sort();
  }
  return {list, load};
}

export function savePlanSnapshot(dir, snapshot) {
  fs.writeFileSync(path.join(dir, 'manifest-snapshot.json'), snapshot, {flag: 'wx'});
  return digest(snapshot);
}

export function readPlanSnapshot(dir, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid queued manifest identity.');
  const file = path.join(dir, 'manifest-snapshot.json');
  if (!fs.lstatSync(file).isFile()) throw Error('Queued manifest snapshot is not a regular file.');
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== expected) throw Error('Queued manifest snapshot failed its checksum.');
  return JSON.parse(bytes);
}
