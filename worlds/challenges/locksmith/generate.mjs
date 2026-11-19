import {readFileSync, writeFileSync} from 'node:fs';
import {courier, designs} from './courier.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check'))
  throw Error('usage: node generate.mjs [--check]');

function artifact(url, text) {
  if (args[0] === '--check') {
    if (readFileSync(url, 'utf8') !== text) throw Error('regenerate ' + url.pathname);
  } else writeFileSync(url, text);
}
const games = [];
for (const [id, {detours, bypasses}] of Object.entries(designs)) {
  const {limit, definition} = courier(detours, bypasses);
  const text = [
    '{"schema":1,"initial":' + JSON.stringify(definition.initial) + ',"states":[',
    definition.states.map((state) => '  ' + JSON.stringify(state)).join(',\n'),
    ']}\n',
  ].join('\n');
  artifact(new URL(id + '.json', import.meta.url), text);
  games.push({
    id,
    file: '../worlds/challenges/locksmith/' + id + '.json',
    limit,
  });
}
const q = {method: 'q_learning', alpha: 0.25, gamma: 0.98, epsilon: 0.25};
const plan = {
  schema: 1,
  name: 'locksmith-courier',
  games,
  arms: [
    {id: 'random', method: 'random'},
    {id: 'q', ...q},
    {id: 'dyna', ...q, method: 'dyna_q', planningSteps: 5},
  ],
  replicates: 8,
  budgetUnit: 'steps',
  maxTrainEpisodes: 16000,
  checkpoints: [0, 512, 2048, 8192],
  validationEpisodes: 16,
  testEpisodes: 32,
  seeds: {
    train: 710000000,
    validation: 1710000000,
    test: 2710000000,
    stride: 20000,
  },
};
artifact(
  new URL('../../../experiments/locksmith-courier.json', import.meta.url),
  JSON.stringify(plan, null, 2) + '\n',
);
