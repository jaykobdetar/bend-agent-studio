// Offline checks only. Never execute commands found in documentation.
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {checkMarkdown} from './docs_markdown.mjs';
import {inventory, checkInventory} from './docs_inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Match this project's ignored output/dependency directories, without invoking Git.
const skip = new Set([
  '.git',
  '.bend-studio',
  'runs',
  'evidence',
  'node_modules',
  '__pycache__',
  '.venv',
]);
function markdown(dir = '') {
  return readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap((e) => {
    const f = dir ? dir + '/' + e.name : e.name;
    if (f === 'tools/docs-check/fixtures') return [];
    if (e.isDirectory() && !skip.has(e.name)) return markdown(f);
    return e.isFile() && e.name.endsWith('.md') ? [f] : [];
  });
}
const files = markdown().sort();
const docs = new Map(files.map((f) => [f, readFileSync(path.join(root, f), 'utf8')]));
const {issues, linkTargets} = checkMarkdown(root, {
  files,
  inlineAllow: [
    // Archive outputs and workspace state, not files shipped with the source tree.
    'run.json',
    'code/',
    'trials/',
    'notes.json',
    '.bend-studio/',
    'training-active.json',
    'design.json',
    'dataset.json',
    'provenance.json',
    'first-study/input-plan.json',
    // Paths inside an installed Python environment and Clang distribution.
    'bin/python',
    'include/clang',
  ],
});
const incoming = new Set(linkTargets.filter((x) => x.target !== x.file).map((x) => x.target));
const errors = [
  ...issues.map((x) => x.file + ':' + x.line + ': ' + x.message + ' (' + x.target + ')'),
  ...checkInventory(inventory(root), docs, incoming),
];
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('Documentation verified: ' + files.length + ' Markdown files.');
