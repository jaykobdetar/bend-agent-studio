import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {solveMatrix, exploitability} from '../analysis/matrix_games.mjs';

const catalog = JSON.parse(
  fs.readFileSync(new URL('../worlds/benchmarks/matrix-games/games.json', import.meta.url)),
);
const profiles = {
  rps: {
    value: '0',
    row: ['1/3', '1/3', '1/3'],
    col: ['1/3', '1/3', '1/3'],
    rowCounts: [1, 1, 1],
    colCounts: [1, 1, 1],
  },
  'weighted-rps': {
    value: '0',
    row: ['1/2', '1/6', '1/3'],
    col: ['1/2', '1/6', '1/3'],
    rowCounts: [3, 1, 2],
    colCounts: [3, 1, 2],
  },
  'matching-pennies': {
    value: '0',
    row: ['1/2', '1/2'],
    col: ['1/2', '1/2'],
    rowCounts: [1, 1],
    colCounts: [1, 1],
  },
  rectangular: {
    value: '2/3',
    row: ['1/3', '2/3'],
    col: ['1/3', '2/3', '0'],
    rowCounts: [1, 2],
    colCounts: [1, 2, 0],
  },
};

test('exact primal and dual matrix-game solutions match known closed forms', () => {
  for (const [key, p] of Object.entries(profiles)) {
    assert.deepEqual(solveMatrix(catalog[key]), {
      value: p.value,
      rowStrategy: p.row,
      columnStrategy: p.col,
    });
    assert.deepEqual(exploitability(catalog[key], p.rowCounts, p.colCounts), {
      expectedPayoff: p.value,
      rowBestResponse: p.value,
      columnBestResponse: p.value,
      rowRegret: '0',
      columnRegret: '0',
      nashConv: '0',
      exploitability: '0',
    });
  }
});

test('singular active sets, degenerate equilibria and negative values are supported', () => {
  assert.equal(solveMatrix(catalog['negative-saddle']).value, '-2');
  assert.deepEqual(solveMatrix(catalog['negative-saddle']).rowStrategy, ['1', '0']);
  assert.deepEqual(solveMatrix([[-4]]), {value: '-4', rowStrategy: ['1'], columnStrategy: ['1']});
  assert.equal(solveMatrix([[4, 1, 2]]).value, '1');
  assert.equal(solveMatrix([[4], [1], [2]]).value, '4');
  assert.equal(solveMatrix(Array.from({length: 6}, () => Array(6).fill(-9))).value, '-9');
  assert.equal(
    solveMatrix([
      [0, -1],
      [-2, 0],
    ]).value,
    '-2/3',
  );
});

test('exploitability reports exact profile regret and normalizes safely', () => {
  assert.deepEqual(exploitability(catalog['matching-pennies'], [4, 0], [9, 0]), {
    expectedPayoff: '1',
    rowBestResponse: '1',
    columnBestResponse: '-1',
    rowRegret: '0',
    columnRegret: '2',
    nashConv: '2',
    exploitability: '1',
  });
  assert.deepEqual(exploitability(catalog.rectangular, [2, 1], [2, 1, 0]), {
    expectedPayoff: '1',
    rowBestResponse: '4/3',
    columnBestResponse: '1/3',
    rowRegret: '1/3',
    columnRegret: '2/3',
    nashConv: '1',
    exploitability: '1/2',
  });
  const big = Number.MAX_SAFE_INTEGER;
  assert.equal(
    exploitability(catalog['matching-pennies'], [big, big], [big, big]).exploitability,
    '0',
  );
  assert.throws(() => solveMatrix([[1], [1, 2]]), /rectangular/);
  assert.throws(() => solveMatrix([Array(2)]), /safe integers/);
  assert.throws(() => solveMatrix([[0.1]]), /safe integers/);
  assert.throws(() => solveMatrix(Array.from({length: 7}, () => [1])), /actions per seat/);
  assert.throws(() => exploitability([[0]], [0], [1]), /positive/);
  assert.throws(() => exploitability([[0]], [-1], [1]), /nonnegative/);
});
