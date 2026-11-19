// Model-based policy values for the *trusted, verified, local* finite-world studies.
// Use the archived compiled preferred-action adapter, not the JS shape of a Q table.
import {resolve} from 'node:path';
import {archive} from '../../offline/dataset.mjs';
import {adapterName,existing} from '../../core/experiment.mjs';
import {policyOracle} from '../../core/public_oracle.mjs';

const root = resolve(process.argv[2] ?? '');
if (process.argv.length !== 3) throw Error('usage: node frozen-values.mjs <trusted run directory>');
const {api, manifest, plan} = await archive(root);
if (plan.games.some(g => !g.definition) ||
    plan.arms.some(a => !['q_learning','dyna_q','random'].includes(a.method) || a.observation !== 'current'))
  throw Error('this study helper only scores current-view random / Q / Dyna on finite JSON games');
const list = xs => xs.reduceRight((tail, head) => ({$: 'Con', head, tail}), {$: 'Nil'});
// Uniform Bend uses a U32 word modulo #legal, not floating ideal uniform.
const uniform = (_, legal) => legal.map((_, i) =>
  (Math.floor(2**32 / legal.length) + Number(i < 2**32 % legal.length)) / 2**32);
console.log('game,arm,replicate,budget,exact_return,return_sd,terminal_probability,checkpoint_hash');
for (const game of plan.games) for (const arm of plan.arms) for (let rep=0; rep<plan.replicates; rep++) {
  let parent = null;
  for (const budget of plan.checkpoints) {
    const cp = existing(root, manifest.hash, {game,arm,rep}, budget, parent);
    if (!cp) throw Error(`missing checkpoint for ${game.id}/${arm.id}/${rep}/${budget}`);
    parent = cp.hash;
    const preferred = api['preferred_' + adapterName(game,arm)];
    const policy = arm.method === 'random' ? uniform : (s,as) => preferred(cp.body.model, s, list(as));
    const {expectedReturn,returnVariance,terminalProbability} = policyOracle(game.definition, game.limit, policy);
    console.log([game.id,arm.id,rep,budget,expectedReturn,Math.sqrt(returnVariance),terminalProbability,cp.hash].join(','));
  }
}
