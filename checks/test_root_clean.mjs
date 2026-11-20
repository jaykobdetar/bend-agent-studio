import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// The devcontainer's clean-source check runs from git archive without metadata.
if (existsSync(new URL('../.git', import.meta.url))) {
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => file && !file.includes('/'));
  if (untracked.length) {
    console.error('Untracked repository-root files after npm test:');
    for (const file of untracked) console.error(JSON.stringify(file));
    process.exitCode = 1;
  }
}
