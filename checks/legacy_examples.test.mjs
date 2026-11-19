// Captured from the pre-M5 entry points at 51c9cb8 with Bend 2.0.40.
// These fixed programs are small; never substitute the configurable study runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {compilerTest} from './support.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(file) {
  const result = spawnSync(process.env.BEND ?? 'bend', [file], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replaceAll('\r\n', '\n');
}
test('standalone doors example keeps its fixed output', compilerTest, () => {
  assert.equal(run('examples/main.bend'),
    'Correct doors on 16 evaluation turns: 8 before training, 16 after training.\n');
});
test('legacy fixed benchmark keeps all 100 CSV rows byte for byte', compilerTest, () => {
  const csv = run('checks/benchmark.bend');
  assert.equal(csv.trimEnd().split('\n').length, 101);
  assert.equal(createHash('sha256').update(csv).digest('hex'),
    'd64e43a492301ac2435d01c6bb802238c04a28a52ef26c7a2ffa7834f09fd815');
});
