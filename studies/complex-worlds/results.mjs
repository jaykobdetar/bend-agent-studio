// Rebuild the published primary comparisons from the three local archives, in order.
import {resolve} from 'node:path';
import {existing, manifestPath, unseal, checkedSnapshot} from '../../core/experiment.mjs';
const paths = process.argv.slice(2);
if (paths.length !== 3) throw Error('usage: node results.mjs <courier run> <switchboard run> <reserve run>');
const expected = ['locksmith-courier','switchboard-2','storm-reserve'];
const result = [];
for (const [i,dir] of paths.entries()) {
  const root=resolve(dir), m = unseal(manifestPath(root)), plan = m.body.plan;
  if (plan.name !== expected[i]) throw Error('wrong study: expected '+expected[i]);
  checkedSnapshot(root, m);
  const at=plan.checkpoints.at(-1);
  const study={study:plan.name,runHash:m.hash,replicates:plan.replicates,budget:at,
    unit:plan.budgetUnit,checkpoints:plan.checkpoints,validationEpisodesPerReplicate:plan.validationEpisodes,
    testEpisodesPerReplicate:plan.testEpisodes,rows:[]};
  for (const game of plan.games) for (const arm of plan.arms) {
    const testMean=[], terminal=[], limited=[], illegal=[], validationMean = plan.checkpoints.map(() => 0);
    for (let rep=0; rep<plan.replicates; rep++) {
      let parent=null, cp;
      for (const [b,n] of plan.checkpoints.entries()) {
        cp=existing(root,m.hash,{game,arm,rep},n,parent);
        if (!cp) throw Error('missing checkpoint');
        parent=cp.hash;
        const v=cp.body.validation;
        if (v.episodes !== plan.validationEpisodes) throw Error('incomplete validation block');
        validationMean[b] += v.sum / (v.episodes * plan.replicates);
      }
      const t=cp.body.test;
      if (t.episodes !== plan.testEpisodes) throw Error('incomplete held-out block');
      testMean.push(t.sum/t.episodes);
      terminal.push(t.terminal); limited.push(t.limited); illegal.push(t.illegal);
    }
    study.rows.push({game:game.id,arm:arm.id,validationMean,testMean,terminal,limited,illegal});
  }
  result.push(study);
}
// One readable line per game/arm: keep replicate blocks together in diffs.
console.log('[\n' + result.map(({rows,...metadata}) => {
  const fields = Object.entries(metadata).map(([k,v]) => '    '+JSON.stringify(k)+': '+JSON.stringify(v));
  fields.push('    "rows": [\n'+rows.map(row=>'      '+JSON.stringify(row)).join(',\n')+'\n    ]');
  return '  {\n'+fields.join(',\n')+'\n  }';
}).join(',\n') + '\n]');
