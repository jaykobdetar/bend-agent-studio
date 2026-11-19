import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {matrixReport} from '../analysis/matrix_report.mjs';
import {generate} from '../tools/matrix-games/generate.mjs';
import {compilerTest} from './support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('matrix world and study regenerate from one exact payoff catalog', () => {
  for (const [file, expected] of generate())
    assert.equal(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), expected);
});
test(
  'verified matrix study keeps commitments private until reveal and scores both learned seats',
  compilerTest,
  async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-matrix-check-'));
    t.after(() => fs.rmSync(home, {recursive: true, force: true}));
    const study = path.join(home, 'study');
    const cli = (...args) =>
      execFileSync(process.execPath, ['experiment.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 45000,
      });
    cli('run', 'experiments/matrix-games.json', study);
    assert.equal(JSON.parse(cli('verify', study)).completeTrials, 80);
    const report = await matrixReport(study);
    assert.equal(report.samplesPerSeatAndArm, 16);
    assert.equal(report.checkpoint, 64);
    assert.equal(report.phase, 'validation');
    assert.equal(report.games.rectangular.equilibrium.value, '2/3');
    assert.equal(report.games['negative-saddle'].arms['q-learning'].exploitability, '0');
    assert.equal(report.games['weighted-rps'].arms['q-learning'].exploitability, '3/4');
    for (const {arms} of Object.values(report.games)) {
      for (const {rowCounts, columnCounts} of Object.values(arms)) {
        const sum = (counts) => counts.reduce((total, count) => total + count, 0);
        assert.equal(sum(rowCounts), 16);
        assert.equal(sum(columnCounts), 16);
      }
    }
  },
);
