import {numberPreservingJson} from '../finite_world.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {validate} from '../experiment_config.mjs';
import {runExperiment} from '../experiment.mjs';
import {guardedSource} from './authoring.mjs';
import {context} from './context.mjs';
try {
  const [workspace, mode, plan, out, ...options] = process.argv.slice(2),
    ctx = context(workspace);
  const raw = mode === 'inline' ? JSON.parse(fs.readFileSync(plan, 'utf8')) : plan;
  const prepared = guardedSource(raw, ctx);
  if (mode === 'inline') {
    validate(prepared); // Never publish invalid inline source, even if compilation fails later.
    const target = ctx.output(path.join(out, 'input-plan.json'));
    fs.writeFileSync(target, numberPreservingJson(raw, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  await runExperiment(prepared, out, options);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
