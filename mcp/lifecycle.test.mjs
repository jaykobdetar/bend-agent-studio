import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {context, exec} from './context.mjs';
import {seal} from '../core/experiment.mjs';

test('Node mapping requires the exact archived version and absolute owner-configured executable', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-map-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const recorded = process.versions.node,
    file = path.join(dir, 'run.json');
  await fs.writeFile(file, seal({toolchain: {node: recorded}}));
  assert.equal(context(dir).nodeFor(dir), process.execPath);
  const different = '0.0.1';
  await fs.writeFile(file, seal({toolchain: {node: different}}));
  assert.throws(() => context(dir).nodeFor(dir), /Node executable/);
  assert.throws(() => context(dir, {[different]: 'node'}).nodeFor(dir), /absolute/);
  assert.throws(() => context(dir, {[different]: process.execPath}).nodeFor(dir), /does not match/);
});
test(
  'deadline kills the runner and spawned descendant before it can perform delayed work',
  {timeout: 20000},
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-timeout-'));
    t.after(() => fs.rm(dir, {recursive: true, force: true}));
    const child = path.join(dir, 'child.mjs'),
      parent = path.join(dir, 'parent.mjs'),
      ready = path.join(dir, 'ready'),
      marker = path.join(dir, 'marker'),
      challenge = path.join(dir, 'after-timeout');
    await fs.writeFile(
      child,
      `import fs from 'node:fs';fs.writeFileSync(process.argv[2],'ready');const poll=setInterval(()=>{if(fs.existsSync(process.argv[4])){fs.writeFileSync(process.argv[3],'survived');clearInterval(poll)}},25);setTimeout(()=>clearInterval(poll),15000).unref();`,
    );
    await fs.writeFile(
      parent,
      `import {spawn} from 'node:child_process';spawn(process.execPath,process.argv.slice(2),{stdio:'ignore'});setInterval(()=>{},10000);`,
    );
    await assert.rejects(
      exec(process.execPath, [parent, child, ready, marker, challenge], {cwd: dir, timeout: 4000}),
      /timed out/,
    );
    assert.equal(await fs.readFile(ready, 'utf8'), 'ready');
    // The Windows tree kill may take time. Challenge the descendant after teardown,
    // not a fixed interval after startup while cancellation might still be running.
    await fs.writeFile(challenge, 'go');
    await wait(1200);
    await assert.rejects(fs.access(marker), {code: 'ENOENT'});
  },
);
