import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodings, switchboard, switchboardHorizon } from './switchboard.mjs';

const [mode, directory, widthArg, delayArg, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  !(
    (mode === '--check' && directory === undefined) ||
    (['--out', '--native-out'].includes(mode) && directory)
  )
)
  throw Error(
    'use --check or (--out|--native-out) NEW_DIRECTORY [WIDTH [DELAY]]',
  );

const width = widthArg === undefined ? 2 : Number(widthArg);
const delay = delayArg === undefined ? 2 : Number(delayArg);
const fixtures = new Map();
const games = encodings.map((encoding, index) => {
  const id = 'switchboard-' + width + '-' + encoding;
  if (mode === '--native-out') {
    const source = fileURLToPath(new URL('switchboard.bend', import.meta.url));
    return {
      id,
      worldFile: path
        .relative(path.resolve(directory), source)
        .split(path.sep)
        .join('/'),
      parameters: { width, delay, encoding: index },
      limit: switchboardHorizon(width, delay, encoding, { native: true }),
    };
  }
  const { definition, horizon } = switchboard(width, delay, encoding);
  const header = JSON.stringify({
    schema: 1,
    initial: definition.initial,
  }).slice(0, -1);
  const filename = id + '.json';
  fixtures.set(
    filename,
    header +
      ',"states":[\n' +
      definition.states.map((s) => JSON.stringify(s)).join(',\n') +
      '\n]}\n',
  );
  return { id, file: filename, limit: horizon };
});
const plan = {
  schema: 1,
  name: 'switchboard-' + width,
  games,
  arms: [
    { id: 'q', method: 'q_learning', epsilon: 0.125, alpha: 0.25, gamma: 1 },
  ],
  replicates: 16,
  checkpoints: [0, 32, 128, 512, 2048],
  validationEpisodes: 128,
  testEpisodes: 512,
  seeds: {
    train: 451000000,
    validation: 1487000000,
    test: 2479000000,
    stride: 80000,
  },
};

if (mode === '--check') {
  // The compact fixture lives under worlds; the Studio-selectable plan under experiments.
  for (const [filename, bytes] of fixtures) {
    if (
      fs
        .readFileSync(new URL(filename, import.meta.url), 'utf8')
        .replaceAll('\r\n', '\n') !== bytes
    )
      throw Error('fixture differs: ' + filename);
  }
  for (const g of games) g.file = '../worlds/challenges/switchboard/' + g.file;
  if (
    fs
      .readFileSync(
        new URL('../../../experiments/switchboard.json', import.meta.url),
        'utf8',
      )
      .replaceAll('\r\n', '\n') !==
    JSON.stringify(plan, null, 2) + '\n'
  )
    throw Error('published plan differs');
} else {
  fs.mkdirSync(directory); // Fail closed if the destination already exists.
  for (const [filename, bytes] of fixtures)
    fs.writeFileSync(path.join(directory, filename), bytes, { flag: 'wx' });
  fs.writeFileSync(
    path.join(directory, 'switchboard.json'),
    JSON.stringify(plan, null, 2) + '\n',
    { flag: 'wx' },
  );
}
