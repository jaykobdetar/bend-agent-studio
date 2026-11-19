import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {checkedSnapshot, readPlan, unseal} from '../core/experiment.mjs';
import {exploitability, solveMatrix} from './matrix_games.mjs';
import {games} from '../tools/matrix-games/generate.mjs';

const planFile = fileURLToPath(new URL('../experiments/matrix-games.json', import.meta.url));

export async function matrixReport(directory) {
  // As with experiment replay, the caller must own and trust this archive.
  const run = path.resolve(directory);
  const manifest = unseal(path.join(run, 'run.json'));
  const {plan, toolchain} = manifest.body;
  assert.equal(
    process.versions.node,
    toolchain.node,
    'use the exact Node version in the run manifest',
  );
  assert.deepEqual(
    plan,
    readPlan(planFile),
    'archive must use the unchanged generated matrix-games plan',
  );
  checkedSnapshot(run, manifest);
  const {replay} = await import(pathToFileURL(path.join(run, 'code/experiment.mjs')));
  const checkpoint = plan.checkpoints.at(-1);
  const report = {};
  const phase = 'validation';
  for (const [id, matrix] of games) {
    const rows = matrix.length;
    const columns = matrix[0].length;
    const results = {};
    for (const arm of plan.arms) {
      const rowCounts = Array(rows).fill(0);
      const columnCounts = Array(columns).fill(0);
      for (const [side, counts] of [
        ['row', rowCounts],
        ['column', columnCounts],
      ]) {
        const game = id + '-' + side;
        for (let rep = 0; rep < plan.replicates; rep++) {
          for (let episode = 0; episode < plan.validationEpisodes; episode++) {
            const trace = await replay(run, game, arm.id, rep, checkpoint, phase, episode);
            assert.equal(trace.frames.length, 1, game + ' must reveal in one step');
            const [frame] = trace.frames;
            assert.equal(trace.initialModel, trace.finalModel, 'validation updates a frozen model');
            assert.equal(frame.observation, 0, 'revealed an action before commitment');
            assert.deepEqual(
              frame.legal,
              counts.map((_, i) => i),
            );
            assert.ok(frame.accepted && frame.terminal && frame.nextLegal.length === 0);
            assert.ok(
              Number.isSafeInteger(frame.nextObservation) &&
                frame.nextObservation >= 1 &&
                frame.nextObservation <= rows * columns,
              'invalid joint-action reveal',
            );
            const row = Math.floor((frame.nextObservation - 1) / columns);
            const column = (frame.nextObservation - 1) % columns;
            assert.equal(
              frame.action,
              side === 'row' ? row : column,
              'played action was not revealed accurately',
            );
            const value = matrix[row][column];
            // The compiled worlds preserve the negative sign of signed zero;
            // for payoff arithmetic either representation of zero is equal.
            assert.ok(
              frame.reward === (side === 'row' ? value : -value),
              'wrong settlement payoff',
            );
            counts[frame.action]++;
          }
        }
      }
      results[arm.id] = {
        rowCounts,
        columnCounts,
        ...exploitability(matrix, rowCounts, columnCounts),
      };
    }
    report[id] = {equilibrium: solveMatrix(matrix), arms: results};
  }
  return {
    run: manifest.hash,
    checkpoint,
    phase,
    samplesPerSeatAndArm: plan.replicates * plan.validationEpisodes,
    profile: 'product of empirical action frequencies from separately trained seats',
    games: report,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert(process.argv.length === 3, 'usage: node analysis/matrix_report.mjs TRUSTED_RUN');
    console.log(JSON.stringify(await matrixReport(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
