// Progress only counts atomically published artifacts. In-flight temp files do
// not count, and an unstarted compiler does not masquerade as a completed run.
import fs from 'node:fs';
import path from 'node:path';
import {context} from './context.mjs';
import {status, unseal} from '../core/experiment.mjs';
try {
  const [root, out, op, encoded] = process.argv.slice(2),
    ctx = context(root),
    args = JSON.parse(encoded);
  const manifest = (dir, file) => {
    const f = ctx.input(path.join(ctx.input(dir), file));
    if (fs.statSync(f).size > 16 * 2 ** 20) throw Error('manifest too large');
    return unseal(f).body;
  };
  const dir = ctx.input(out);
  if (['start_run', 'resume_run', 'rerun'].includes(op)) {
    const file = path.join(dir, 'run.json');
    process.stdout.write(JSON.stringify(fs.existsSync(file) ? status(ctx.archive(dir)) : null));
  } else {
    const step = op === 'start_assessment' ? 'assess' : args.step;
    const designFile = {
      assess: 'assessment.json',
      collect: 'design.json',
      fit: 'fit.json',
      score: 'score.json',
    }[step];
    const unit = {assess: 'evaluations', collect: 'partitions', fit: 'models', score: 'scores'}[
      step
    ];
    let total = null,
      completed = 0,
      entries = 0;
    function count(folder, extension) {
      const folderPath = path.join(dir, folder);
      if (!fs.existsSync(folderPath)) return;
      function visit(p) {
        for (const e of fs.readdirSync(p, {withFileTypes: true})) {
          if (++entries > 200000) throw Error('progress exceeds inspection limit');
          if (e.isDirectory()) visit(path.join(p, e.name));
          else if (!e.isFile()) throw Error('links and special files are not permitted');
          else if (e.name.endsWith(extension)) completed++;
        }
      }
      visit(ctx.input(folderPath));
    }
    if (fs.existsSync(path.join(dir, designFile))) {
      const design = manifest(dir, designFile);
      if (step === 'assess') {
        total =
          manifest(args.run, 'run.json').plan.replicates *
          design.spec.targets.length *
          design.spec.comparisons.length;
        count('trials', '.json');
      }
      if (step === 'collect') {
        total = design.replicates * 2;
        count('fit', '.jsonl');
        count('holdout', '.jsonl');
      }
      if (step === 'fit') {
        total = manifest(args.dataset, 'design.json').replicates * design.spec.arms.length;
        count('models', '.json');
      }
      if (step === 'score') {
        total =
          manifest(args.models, 'fit.json').spec.arms.length *
          manifest(args.dataset, 'design.json').replicates;
        count('trials', '.json');
      }
      if (!Number.isSafeInteger(total) || total < 0 || completed > total)
        throw Error('invalid progress dimensions');
    }
    process.stdout.write(JSON.stringify({unit, completed, total}));
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
