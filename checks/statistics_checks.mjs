import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('stdlib suite statistics: CLI compatibility, paired/bootstrap invariants, ties and unbalanced tasks', () => {
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-m', 'unittest', '-v', 'test_suite_stats'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', timeout: 30000
    });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
