// Trusted local artifacts only. Measure agreement and ESS as decisions accumulate,
// holding the learning problem, target policy and logs fixed.
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unseal} from '../../../core/experiment.mjs';
import {digest} from '../../../core/experiment_config.mjs';
import {offPolicy} from '../../../offline/batch.mjs';
import {openDataset} from '../../../offline/dataset.mjs';

if (process.argv.length !== 5)
  throw Error('usage: node prefix.mjs <data directory> <fit directory> <arm>');
const [dataPath, modelPath, arm] = process.argv.slice(2);
const data = openDataset(resolve(dataPath));
const model = resolve(modelPath);
const fit = unseal(join(model, 'fit.json'));
if (
  fit.body.dataset !== data.index.hash ||
  fit.body.toolchain.node !== process.versions.node ||
  !fit.body.spec.arms.some((a) => a.id === arm)
)
  throw Error('fit, data, arm or Node version do not match');
const backend = join(model, 'code', 'fitter.mjs');
if (digest(readFileSync(backend)) !== fit.body.toolchain.hashes['fitter.mjs'])
  throw Error('fitting backend checksum mismatch');
const {default: api} = await import(pathToFileURL(backend).href);
const list = (xs) => xs.reduceRight((tail, head) => ({$: 'Con', head, tail}), {$: 'Nil'});
const buckets = Math.round(data.design.spec.epsilon * 65536);
console.log('replicate,prefix,episodes,matched,unsupported,ess');
for (let rep = 0; rep < data.design.replicates; rep++) {
  const cp = unseal(join(model, 'models', arm, rep + '.json'));
  if (cp.body.fit !== fit.hash || cp.body.rep !== rep || cp.body.arm !== arm)
    throw Error('model lineage mismatch');
  const action = (s, legal) => api.act(cp.body.model, s, list(legal), {$: 'Evaluate'}, 0);
  const trajectories = data.episodes('holdout', rep);
  for (const n of [1, 3, 6, 9, 12]) {
    const prefix = trajectories.map((ep) => {
      const frames = ep.frames.slice(0, n);
      return {frames, score: frames.reduce((s, f) => s + f.reward, 0)};
    });
    const {episodes, matched, unsupported, ess} = offPolicy(prefix, action, buckets);
    console.log([rep, n, episodes, matched, unsupported, ess].join(','));
  }
}
