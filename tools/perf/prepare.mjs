import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stormReserve} from '../../worlds/challenges/storm-reserve/world.mjs';
import {sensorWorld, trainRoads} from '../../studies/complex-worlds/kart-transfer/design.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.resolve(process.argv[2] ?? '');
if (process.argv.length !== 3) throw Error('usage: node tools/perf/prepare.mjs <new-input-dir>');
fs.mkdirSync(out);
const val = (filename) => JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8'));
const write = (name, x) =>
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(x, null, 2) + '\n', {flag: 'wx'});
const rebase = (plan, file) => {
  const dir = path.join(root, path.dirname(file));
  for (const g of [...plan.games, ...(plan.evaluationGames ?? [])])
    for (const k of ['file', 'worldFile']) if (g[k]) g[k] = path.resolve(dir, g[k]);
  for (const arm of plan.arms) if (arm.agentFile) arm.agentFile = path.resolve(dir, arm.agentFile);
  return plan;
};
const flagshipFile = 'experiments/flagship-toy-text-v2.json';
const flagship = rebase(val(flagshipFile), flagshipFile);
const families = [
  ['baseline', 'bandit-2', ['random']],
  ['one-step', 'lake4-slip', ['q_learning', 'expected_sarsa', 'sarsa']],
  ['double', 'lake4-dry', ['double_q']],
  ['planning', 'cliff4x12', ['dyna_q']],
  ['multi-step', 'deep-sea-3', ['n_step', 'td_lambda']],
];
assert.deepEqual(families.flatMap((x) => x[2]).sort(), flagship.arms.map((a) => a.id).sort());
for (const [id, world, arms] of families) {
  const games = flagship.games.filter((g) => g.id === world);
  assert.equal(games.length, 1);
  write('flagship-' + id, {
    ...flagship,
    name: 'perf-flagship-' + id,
    replicates: 3,
    games,
    arms: flagship.arms.filter((a) => arms.includes(a.id)),
  });
}
const storm = 'reserve-24x8';
write(storm, stormReserve(24, 8).definition);
write('storm', {
  schema: 1,
  name: 'perf-storm-24x8',
  games: [{id: storm, file: storm + '.json', limit: 24}],
  arms: [
    {id: 'q', method: 'q_learning', alpha: 0.125, gamma: 1, epsilon: 0.25},
    {id: 'dyna', method: 'dyna_q', alpha: 0.125, gamma: 1, epsilon: 0.25, planningSteps: 5},
  ],
  replicates: 8,
  checkpoints: [0, 256, 1024, 4096],
  validationEpisodes: 32,
  testEpisodes: 256,
  seeds: {train: 373000000, validation: 1693000000, test: 2993000000, stride: 20000},
});
write('practice-suite', sensorWorld(trainRoads));
write('kart', {
  schema: 1,
  name: 'perf-kart-transfer',
  games: [
    {
      id: 'practice-suite',
      file: 'practice-suite.json',
      limit: Math.max(...trainRoads.map((r) => r.length)),
    },
  ],
  arms: [
    {id: 'tabular', method: 'q_learning', alpha: 0.25, epsilon: 0.25, gamma: 1},
    {
      id: 'shared',
      method: 'custom',
      agentFile: path.join(root, 'studies/complex-worlds/kart-transfer/kart_features.bend'),
    },
  ],
  replicates: 8,
  budgetUnit: 'steps',
  maxTrainEpisodes: 70000,
  checkpoints: [0, 1024, 4096, 16384, 65536],
  validationEpisodes: 32,
  testEpisodes: 64,
  seeds: {train: 987000000, validation: 1953000000, test: 3167000000, stride: 100000},
});
const pole = val('experiments/cartpole.json');
write('cartpole', {
  schema: 1,
  name: 'perf-cartpole-network',
  games: pole.games,
  arms: pole.arms.filter((a) => a.id === 'network'),
  replicates: 1,
  checkpoints: [0, 8, 32, 64],
  validationEpisodes: 4,
  testEpisodes: 8,
  seeds: pole.seeds,
});
const acrobotFile = 'experiments/acrobot.json';
write('acrobot', rebase(val(acrobotFile), acrobotFile));
const sha = (x) => createHash('sha256').update(x).digest('hex');
const files = fs.readdirSync(out).sort();
const inputHashes = Object.fromEntries(
  files.map((file) => [
    file,
    sha(fs.readFileSync(path.join(out, file), 'utf8').replaceAll(root, '<REPO>/')),
  ]),
);
const verifyFiles = [
  'worlds/benchmarks/toy-text/lake4-slip.json',
  'worlds/benchmarks/toy-text/lake4-dry.json',
  'worlds/benchmarks/toy-text/cliff4x12.json',
  'worlds/benchmarks/probes/bandit-2.json',
  'worlds/benchmarks/probes/deep-sea-3.json',
  'worlds/benchmarks/toy-text/taxi.json',
  'worlds/challenges/storm-reserve/reserve-12x4.json',
  'studies/flagship-toy-text-v2/checkpoints.csv',
  'studies/flagship-toy-text-v2/anchors.json',
];
const publicHashes = Object.fromEntries(
  verifyFiles.map((file) => [file, sha(fs.readFileSync(path.join(root, file)))]),
);
write('input-hashes', {prepared: inputHashes, public: publicHashes});
