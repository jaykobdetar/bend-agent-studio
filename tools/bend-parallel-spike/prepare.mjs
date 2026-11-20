// Prepare a narrow diagnostic in a NEW directory; never write into the archive.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {adapterName, unseal} from '../../core/experiment.mjs';

const [archive, destination, option, ...rest] = process.argv.slice(2);
assert(archive && destination && !rest.length && (option === undefined || option === '--cuda'));
const a = realpathSync(archive);
const stage = path.join(realpathSync(path.dirname(destination)), path.basename(destination));
assert(stage !== a && !stage.startsWith(a + path.sep), 'stage must be outside the archive');
const identity = JSON.parse(
  readFileSync(new URL('../../studies/flagship-toy-text-v2/identity.json', import.meta.url)),
);
const manifest = unseal(path.join(a, 'run.json'));
assert.equal(manifest.hash, identity.sealedManifestHash);
assert.deepEqual(manifest.body.toolchain, identity.toolchain);
const plan = manifest.body.plan;
const game = plan.games.find((g) => g.id === 'lake4-slip');
const q = plan.arms.find((arm) => arm.id === 'q_learning');
const name = adapterName(game, q);
assert.equal(name, 'scene_95d3e437f0ac10c9e259');
const sources = new Map();
for (const [file, expected] of Object.entries(identity.toolchain.sources)) {
  if (!file.endsWith('.bend')) continue;
  assert(/^[\w.-]+\.bend$/.test(file), file);
  const bytes = readFileSync(path.join(a, 'code', file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, file);
  sources.set(file, bytes);
}
const full = sources.get('study.bend').toString();
const stock = readFileSync(new URL('../../core/study.bend', import.meta.url), 'utf8');
assert(full.includes(stock), 'expect an unchanged R10.2-era stock study module');
const imp = full.match(new RegExp(`^import \\./${name}\\.bend as [^\\n]+$`, 'm'))?.[0];
const adapter = full.match(new RegExp(`^def ${name}\\([^\\n]+\\n[^\\n]+$`, 'm'))?.[0];
assert(imp && adapter, 'expected exact generated finite-world adapter');
sources.set('study.bend', imp + '\n' + stock + '\n' + adapter + '\n');

let code = readFileSync(new URL('./population.bend.txt', import.meta.url), 'utf8');
if (option === '--cuda') {
  const cpu = '    case Some{1} Some{a}: print_rows(fork(3n,0,8,a))';
  assert(code.includes(cpu));
  code = code
    .replace(cpu, cpu + '\n    case Some{2} Some{a}: print_rows(fork!(3n,0,8,a))')
    .replace('usage: population 0|1 ARM', 'usage: population 0|1|2 ARM');
}
sources.set('population.bend', code);
mkdirSync(stage, {mode: 0o700});
for (const [file, bytes] of sources)
  writeFileSync(path.join(stage, file), bytes, {flag: 'wx', mode: 0o600});
