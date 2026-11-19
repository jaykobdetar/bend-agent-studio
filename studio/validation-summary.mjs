// Read checkpoint data only. Never import a run's executable backend or replay it.
import fs from 'node:fs';
import path from 'node:path';
import {existing, unseal} from '../core/experiment.mjs';
import {canonical, digest} from '../core/experiment_config.mjs';

const MAX_ROWS = 8192,
  MAX_BYTES = 64 * 1024 * 1024;
const goodId = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
function check(test, message) {
  if (!test) throw Error(message);
}
export function point(values, budget) {
  const n = values.length,
    mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return {budget, mean, interval: null, replicates: n};
  // Fixed replicates resampled as entire units, not their individual episodes.
  // A stable local stream leaves experiment RNG and the caller's process untouched.
  let word = 0x91e10da5;
  const means = [];
  for (let b = 0; b < 1000; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      word ^= word << 13;
      word ^= word >>> 17;
      word ^= word << 5;
      sum += values[Math.floor(((word >>> 0) / 4294967296) * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {budget, mean, interval: [means[24], means[974]], replicates: n};
}
export function validationSummary(dir) {
  let bytes = 0;
  const root = fs.realpathSync(dir);
  const account = (file) => {
    const relative = path.relative(root, fs.realpathSync(file));
    check(
      relative &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep) &&
        !path.isAbsolute(relative),
      'Comparison inputs must remain inside the run directory.',
    );
    const stat = fs.lstatSync(file);
    check(
      stat.isFile() && (bytes += stat.size) <= MAX_BYTES,
      'Run exceeds the comparison data limit or has an invalid file.',
    );
  };
  const manifestFile = path.join(dir, 'run.json');
  account(manifestFile);
  const m = unseal(manifestFile),
    p = m.body.plan;
  const unit = p.budgetUnit ?? 'episodes';
  check(['steps', 'episodes'].includes(unit), 'Unrecognized budget unit.');
  check(
    Array.isArray(p.games) &&
      p.games.length &&
      Array.isArray(p.arms) &&
      p.arms.length &&
      [...p.games, ...p.arms].every((v) => v && goodId(v.id)),
    'Invalid run identities.',
  );
  check(
    Array.isArray(p.checkpoints) &&
      p.checkpoints.length &&
      p.checkpoints.every(
        (v, i) => Number.isSafeInteger(v) && v >= 0 && (i === 0 || v > p.checkpoints[i - 1]),
      ),
    'Invalid checkpoint schedule.',
  );
  check(
    Number.isSafeInteger(p.replicates) &&
      p.replicates > 0 &&
      p.games.length * p.arms.length * p.checkpoints.length * p.replicates <= MAX_ROWS,
    'Run exceeds the comparison row limit.',
  );
  check(
    Number.isSafeInteger(p.validationEpisodes) && p.validationEpisodes > 0,
    'No validation episodes.',
  );
  const series = [];
  for (const game of p.games)
    for (const arm of p.arms) {
      const groups = p.checkpoints.map(() => []);
      for (let rep = 0; rep < p.replicates; rep++) {
        let previous = null;
        for (const [i, budget] of p.checkpoints.entries()) {
          account(path.join(dir, 'trials', game.id, arm.id, String(rep), budget + '.json'));
          const row = existing(dir, m.hash, {game, arm, rep}, budget, previous);
          check(row, 'Missing checkpoint.');
          previous = row.hash;
          const v = row.body.validation;
          check(
            v?.episodes === p.validationEpisodes && Number.isFinite(v.sum),
            'Invalid validation statistics.',
          );
          groups[i].push(v.sum / v.episodes);
        }
      }
      series.push({
        game: game.id,
        gameSpecHash: digest(canonical(game)),
        arm: arm.id,
        points: groups.map((values, i) => point(values, p.checkpoints[i])),
      });
    }
  return {phase: 'validation', metric: 'mean episode return', budgetUnit: unit, series};
}
