import {execFileSync} from 'node:child_process';
import {lstatSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const root = realpathSync(path.resolve(here, '../..'));
const scopes = [
  'studio',
  'mcp',
  'analysis',
  'tools',
  'checks',
  'offline',
  'integrations',
  'benchmarks',
];
const [, , mode, ...rest] = process.argv;
if (!['--check', '--write', '--debug-check'].includes(mode) || rest.length)
  throw Error('Use npm run check, write or audit inside tools/format.');

const entries = execFileSync('git', ['ls-files', '-z', '--stage', '--', ...scopes], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .map((entry) => {
    const at = entry.indexOf('\t');
    const [mode, , stage] = entry.slice(0, at).split(' ');
    return {mode, stage, file: entry.slice(at + 1)};
  });

const exclusions = ['tools/docs-check/fixtures/'];
const files = entries
  .filter(
    ({mode, stage, file}) =>
      ['100644', '100755'].includes(mode) &&
      stage === '0' &&
      /\.(mjs|js)$/.test(file) &&
      !exclusions.some((prefix) => file.startsWith(prefix)) &&
      !/(?:^|\/)(?:node_modules|vendor|generated)(?:\/|$)|\.generated\.(?:mjs|js)$/.test(file),
  )
  .map(({file}) => file);
if (files.length === 0) throw Error('No tracked JavaScript sources found in formatter scope.');
for (const file of files) {
  const resolved = path.join(root, file);
  if (!lstatSync(resolved).isFile() || realpathSync(resolved) !== resolved)
    throw Error('Tracked formatter source is not a regular file at its checkout path: ' + file);
}
const config = path.join(here, 'prettier.json');
const cli = path.join(here, 'node_modules/prettier/bin/prettier.cjs');
// File chunks avoid the platform-specific command-line length limit.
for (let i = 0; i < files.length; i += 64) {
  execFileSync(
    process.execPath,
    [
      cli,
      mode,
      '--config',
      config,
      '--ignore-path',
      config + '.ignore',
      '--no-editorconfig',
      '--',
      ...files.slice(i, i + 64),
    ],
    {cwd: root, stdio: 'inherit'},
  );
}
