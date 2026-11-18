// Frozen-policy transfer and early-stopping comparisons share held-out seed blocks.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {canonical, checkSeedBlocks, digest} from './experiment_config.mjs';
import {allGames, checkedSnapshot, existing, gameRunner, immutable, json, manifestPath, seal, testModel, unseal} from './experiment.mjs';

const id = s => typeof s==='string' && /^[a-z][a-z0-9_-]{0,79}$/.test(s);
const unsigned = n => Number.isSafeInteger(n) && n>=0 && n<=0xffffffff;
const domain = g => g.domain ?? (['cartpole','mountain_car'].includes(g.id)?g.id:'discrete');
const vocabulary = g => [...new Set(g.definition.states.map(s=>s.observation))].sort((a,b)=>a-b);

function shape(obj, fields, where) {
  if (!obj || typeof obj!=='object' || Array.isArray(obj) || Object.keys(obj).some(k=>!fields.includes(k))) {
    throw Error('unknown or invalid fields in '+where);
  }
}

export function validateAssessment(p, spec) {
  shape(spec,['schema','name','comparisons','targets','episodes','seeds'],'assessment');
  shape(spec.seeds,['start','stride'],'assessment seeds');
  const {comparisons,targets,episodes,seeds}=spec;
  if (spec.schema!==1 || !id(spec.name) || !unsigned(episodes) || episodes<1 ||
      !unsigned(seeds.start) || !unsigned(seeds.stride) || seeds.stride<1) throw Error('invalid assessment design');
  for (const list of [comparisons,targets]) {
    if (!Array.isArray(list) || !list.length) throw Error('assessment requires comparisons and targets');
  }
  if (new Set(targets).size!==targets.length || new Set(comparisons.map(c=>c.id)).size!==comparisons.length) {
    throw Error('duplicate assessment target or comparison');
  }
  const games=allGames(p);
  for (const c of comparisons) {
    shape(c,['id','source','arm','checkpoint','minimumBudget'],'comparison');
    const game=p.games.find(g=>g.id===c.source), arm=p.arms.find(a=>a.id===c.arm);
    if (!id(c.id) || !game || !arm) throw Error('unknown source game, arm, or comparison id');
    if (!['final','best-validation'].includes(c.checkpoint) && !p.checkpoints.includes(c.checkpoint)) throw Error('invalid checkpoint selection');
    if (c.minimumBudget!==undefined && (c.checkpoint!=='best-validation' || !p.checkpoints.includes(c.minimumBudget))) {
      throw Error('minimumBudget must be a declared budget for best-validation');
    }
    for (const name of targets) {
      const target=games.find(g=>g.id===name);
      if (!target || domain(target)!==domain(game)) throw Error('unknown or incompatible transfer target '+name);
      if (arm.observation==='previous' && (!game.definition || !target.definition ||
          canonical(vocabulary(game))!==canonical(vocabulary(target)))) throw Error('incompatible observation history vocabulary');
    }
  }
  const heldout={initializesModel:false,replicates:p.replicates,checkpoints:[0],maxTrainEpisodes:0,validationEpisodes:0,testEpisodes:episodes,
    seeds:{train:0,validation:0,test:seeds.start,stride:seeds.stride}};
  checkSeedBlocks([p,heldout]);
  return spec;
}

function sourceCheckpoint(root, manifest, comparison, rep) {
  const p=manifest.body.plan, game=p.games.find(g=>g.id===comparison.source), arm=p.arms.find(a=>a.id===comparison.arm);
  const fixed=comparison.checkpoint==='final'?p.checkpoints.at(-1):comparison.checkpoint;
  let parent=null, selected=null;
  for (const n of p.checkpoints) {
    const item=existing(root,manifest.hash,{game,arm,rep},n,parent);
    if (!item) throw Error('missing source checkpoint '+[game.id,arm.id,rep,n].join('/'));
    parent=item.hash;
    if (fixed===n) return item;
    if (fixed==='best-validation' && n>=(comparison.minimumBudget??0) &&
        (!selected || item.body.validation.mean>selected.body.validation.mean)) selected=item;
  }
  return selected;
}

export async function assess(root, config, output) {
  const manifest=unseal(manifestPath(root)), p=manifest.body.plan, tc=manifest.body.toolchain;
  const spec=validateAssessment(p,json(config));
  if (tc.node!==process.versions.node) throw Error('assessment needs Node '+tc.node);
  checkedSnapshot(root,manifest);
  const api=(await import(pathToFileURL(path.join(root,'code','backend.mjs')).href)).default;
  const host=Object.fromEntries(['experiment.mjs','assessment.mjs','experiment_config.mjs'].map(name=>
    [name,digest(fs.readFileSync(fileURLToPath(new URL(name,import.meta.url))))]));
  const design=seal({sourceRun:manifest.hash,toolchain:tc.backend,host,spec});
  immutable(path.join(output,'assessment.json'),design);
  const identity=JSON.parse(design).hash;
  const keys=['target','comparison','source','arm','replicate','budget','model_hash','source_checkpoint','seed',
    'episodes','sum','steps','terminal','limited','illegal','min','max','m2'];
  const lines=[keys.join(',')];
  for (let rep=0;rep<p.replicates;rep++) for (const c of spec.comparisons) {
    const row=sourceCheckpoint(root,manifest,c,rep), model=row.body.model, hash=digest(canonical(model));
    const arm=p.arms.find(a=>a.id===c.arm), seed=spec.seeds.start+rep*spec.seeds.stride;
    for (const name of spec.targets) {
      const file=path.join(output,'trials',name,c.id,rep+'.json');
      let saved;
      if (fs.existsSync(file)) {
        saved=unseal(file).body;
        if (saved.assessment!==identity || saved.source_checkpoint!==row.hash || saved.seed!==seed ||
            saved.target!==name || saved.comparison!==c.id || saved.replicate!==rep) throw Error('assessment result identity mismatch');
      } else {
        const target=allGames(p).find(g=>g.id===name);
        const metrics=testModel(gameRunner(api,target,arm),target,model,seed,spec.episodes);
        if (digest(canonical(model))!==hash) throw Error('evaluation changed its input model');
        saved={assessment:identity,target:name,comparison:c.id,source:c.source,arm:c.arm,replicate:rep,
          budget:row.body.episodes,model_hash:hash,source_checkpoint:row.hash,seed,...metrics};
        immutable(file,seal(saved));
      }
      lines.push(keys.map(k=>saved[k]).join(','));
    }
  }
  immutable(path.join(output,'assessment.csv'),lines.join('\n')+'\n');
  console.log(spec.name+': '+(lines.length-1)+' frozen-policy evaluations.');
}
