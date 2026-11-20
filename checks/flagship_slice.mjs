import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'bend-historical-training-'));
const hashes = 'studies/flagship-toy-text/checkpoint-hashes.json';
const demos = 'studio/web/demos';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checked = (dir, file) => readFileSync(path.join(dir, file));
const readJson = (dir, file) => JSON.parse(checked(dir, file));

function historicalTree(name, commit, tree) {
  const git = (...args) => execFileSync('git', args, {cwd: repo, maxBuffer: 16 * 2 ** 20});
  assert.equal(
    git('rev-parse', commit + '^{tree}')
      .toString()
      .trim(),
    tree,
  );
  const dir = path.join(temp, name);
  mkdirSync(dir);
  // Only pinned, trusted project history is replayed. No fetch or worktree edit.
  execFileSync('tar', ['-xf', '-', '-C', dir], {input: git('archive', commit)});
  return dir;
}
function cli(root, ...args) {
  return execFileSync(process.execPath, [path.join(root, 'experiment.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function flagshipSlice(old) {
  assert.deepEqual(checked(repo, hashes), checked(old, hashes), 'original checkpoint byte pins');
  for (const name of readdirSync(path.join(old, demos))) {
    const file = path.join(demos, name);
    assert.equal(sha256(checked(repo, file)), sha256(checked(old, file)), file);
  }
  console.log('Shipped demo bytes match the Phase 9 release tree.');

  execFileSync(process.execPath, [path.join(old, 'checks/flagship_slice.mjs')], {
    cwd: old,
    stdio: 'inherit',
    timeout: 120000,
  });
}

function legacyStepContinuity(old) {
  const plan = path.join(temp, 'toy-step.json');
  const paused = path.join(temp, 'paused');
  const uninterrupted = path.join(temp, 'uninterrupted');
  writeFileSync(
    plan,
    JSON.stringify({
      schema: 1,
      name: 'historical-step-fixture',
      games: [
        {
          id: 'walk',
          limit: 5,
          definition: {
            schema: 1,
            initial: [{to: 0, weight: 1}],
            states: [
              {
                id: 0,
                actions: [
                  {id: 11, outcomes: [{to: 0, weight: 1, reward: 0}]},
                  {id: 12, outcomes: [{to: 1, weight: 1, reward: 1}]},
                ],
              },
              {id: 1, actions: []},
            ],
          },
        },
      ],
      arms: [{id: 'q', method: 'q_learning', epsilon: 0}],
      replicates: 1,
      budgetUnit: 'steps',
      checkpoints: [0, 2, 7],
      validationEpisodes: 1,
      testEpisodes: 1,
      seeds: {train: 40, validation: 50, test: 60, stride: 10},
    }),
  );
  cli(old, 'run', plan, paused, '--until', '2');
  const file = (n) => `trials/walk/q/0/${n}.json`;
  const step2 = readJson(paused, file(2)).body;
  assert.equal(step2.partial.steps, 2);
  assert.notDeepEqual(step2.model, readJson(paused, file(0)).body.model);
  const args = ['replay', paused, 'walk', 'q', '0', '2', 'train', '0'];
  const prefix = JSON.parse(cli(old, ...args));
  assert.equal(prefix.reason.$, 'Paused');
  assert.equal(prefix.steps, 2);
  assert.equal(prefix.score, 0);
  assert.deepEqual(
    prefix.frames.map((f) => f.action),
    [11, 11],
  );
  assert.equal(cli(repo, ...args), cli(old, ...args), 'paused train replay bytes');

  cli(old, 'run', plan, uninterrupted);
  cli(repo, 'resume', paused);
  assert.deepEqual(JSON.parse(cli(repo, 'verify', paused)), {
    experiment: 'historical-step-fixture',
    completeTrials: 1,
    totalTrials: 1,
    savedCheckpoints: 3,
    totalCheckpoints: 3,
  });
  for (const checkpoint of [0, 2, 7])
    assert.deepEqual(checked(paused, file(checkpoint)), checked(uninterrupted, file(checkpoint)));
  const finalArgs = ['walk', 'q', '0', '7', 'test', '0'];
  assert.equal(
    cli(repo, 'replay', paused, ...finalArgs),
    cli(old, 'replay', uninterrupted, ...finalArgs),
  );
  console.log(
    'Pre-R10 nonzero step archive: cursor replay, resume, verification and final bytes match.',
  );
}

try {
  flagshipSlice(
    historicalTree(
      'phase-nine',
      '1973d8f2e39f13d32cb15d26c01ab0a267b410da',
      'bfdc1063b7dbb906eb4f61795ab949e780744bc9',
    ),
  );
  legacyStepContinuity(
    historicalTree(
      'pre-r10',
      '032375733bb9559d77cea59b812654fd35d5bfe5',
      '30ca2f4622e3c4a91a2a7539fb69525d928ba4bc',
    ),
  );
} finally {
  rmSync(temp, {recursive: true, force: true});
}
