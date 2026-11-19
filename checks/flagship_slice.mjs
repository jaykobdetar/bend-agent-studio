import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {trials} from '../core/experiment_config.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const planFile = path.join(repo, 'experiments/flagship-toy-text.json');
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const expected = JSON.parse(readFileSync(
  path.join(repo, 'studies/flagship-toy-text/checkpoint-hashes.json'), 'utf8',
));
const all = [...trials(plan)];
const checkpoint = plan.checkpoints[0];
const temp = mkdtempSync(path.join(os.tmpdir(), 'bend-flagship-slice-'));
const run = path.join(temp, 'run');
const cli = (...args) => execFileSync(process.execPath, [path.join(repo, 'experiment.mjs'), ...args], {
  cwd: repo,
  stdio: 'inherit',
});

try {
  for (const [n, arm] of ['random', 'q_learning'].entries()) {
    const game = 'lake4-slip';
    const replicate = 0;
    const index = all.findIndex(t => t.game.id === game && t.arm.id === arm && t.rep === replicate);
    assert.ok(index >= 0, `missing study trial for ${arm}`);
    const opts = ['--until', String(checkpoint), '--shard', `${index}/${all.length}`];
    if (n === 0) cli('run', planFile, run, ...opts);
    else cli('resume', run, ...opts);
    const relative = `trials/${game}/${arm}/${replicate}/${checkpoint}.json`;
    const bytes = readFileSync(path.join(run, relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected[relative], relative);
  }
  console.log('Flagship slice: both original checkpoint byte hashes match.');
} finally {
  rmSync(temp, {recursive: true, force: true});
}
