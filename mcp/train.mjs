import {numberPreservingJson} from '../finite_world.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {runPlan} from '../experiment.mjs';
import {guardedPlan} from './authoring.mjs';
import {context} from './context.mjs';
try {
  const [workspace, mode, plan, out, ...options] = process.argv.slice(2),
    ctx = context(workspace);
  const raw = mode === 'inline' ? JSON.parse(fs.readFileSync(plan, 'utf8')) : plan;
  const normalized = guardedPlan(raw, ctx);
  if (mode === 'inline') {
    const target = ctx.output(path.join(out, 'input-plan.json'));
    fs.writeFileSync(target, numberPreservingJson(raw, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  await runPlan(normalized, out, options);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
