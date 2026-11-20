// Private benchmark witness only: compare complete bytes, never save an archive.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isMainThread, parentPort, Worker, workerData} from 'node:worker_threads';
import {checkedSnapshot, gameRunner, manifestPath, record, seal, stats, status, testModel, unseal} from '../../../core/experiment.mjs';
import {seedOf, settings} from '../../../core/experiment_config.mjs';

const lock = JSON.parse(fs.readFileSync(new URL('./workload.json', import.meta.url), 'utf8'));
const backendPath = root => path.join(root, 'code', 'backend.mjs');
const checkpointPath = (root, game, arm, rep, point) =>
  path.join(root, 'trials', game.id, arm.id, String(rep), point + '.json');
const comparePath = (a,b) => a < b ? -1 : a === b ? 0 : 1;

function checkIdentity(manifest) {
  assert.equal(manifest.hash, lock.manifest, 'wrong P11.0 manifest');
  const {plan,toolchain} = manifest.body;
  assert.equal(plan.name, lock.cell);
  assert.equal(plan.budgetUnit,'episodes');
  assert.equal(toolchain.backend, lock.backend, 'wrong P11.0 backend');
  assert.equal(toolchain.node, process.versions.node);
  assert.equal(toolchain.bend, 'bend 2.0.40');
}

function checkCounts(root, manifest) {
  const p = manifest.body.plan;
  const [game] = p.games, [arm] = p.arms;
  const files = [];
  const totals = Object.fromEntries(['train','validation','test'].map(k => [k,{episodes:0,steps:0}]));
  for (let rep = 0; rep < p.replicates; ++rep) {
    for (const point of p.checkpoints) {
      const f = checkpointPath(root,game,arm,rep,point);
      files.push(f);
      const b = unseal(f).body;
      for (const phase of Object.keys(totals)) {
        if (b[phase] && (phase !== 'train' || point === p.checkpoints.at(-1))) {
          totals[phase].episodes += b[phase].episodes;
          totals[phase].steps += b[phase].steps;
        }
      }
    }
  }
  const hash = createHash('sha256');
  for (const file of files.sort(comparePath))
    hash.update(path.relative(root,file)).update('\0').update(fs.readFileSync(file));
  assert.equal(files.length, lock.checkpointFiles);
  assert.equal(hash.digest('hex'), lock.trialSetSha256);
  assert.deepEqual(totals, lock.phaseTotals);
  return totals;
}

async function compareShard(root, manifest, first, stride) {
  const {plan} = manifest.body;
  if (first >= plan.replicates) return [];
  const [g] = plan.games, [a] = plan.arms;
  const {default: api} = await import(pathToFileURL(backendPath(root)).href);
  const engine = gameRunner(api,g,a);
  const config = settings(a,g);
  const matches = [];
  const mode = {$:'Train'};
  for (let rep = first; rep < plan.replicates; rep += stride) {
    const trainSeed = seedOf(plan,rep,'train');
    const validationSeed = seedOf(plan,rep,'validation');
    const testSeed = seedOf(plan,rep,'test');
    let model = engine.initial(config,trainSeed), parent = null, done = 0;
    const train = stats();
    for (const point of plan.checkpoints) {
      for (let i = done; i < point; ++i) {
        const result = engine.episode(mode,model,trainSeed+i,g.limit);
        model = result.model;
        record(train,result);
      }
      const validation = testModel(engine,g,model,validationSeed,plan.validationEpisodes);
      const test = point === plan.checkpoints.at(-1) && plan.testEpisodes
        ? testModel(engine,g,model,testSeed,plan.testEpisodes) : null;
      const bytes = seal({experiment:manifest.hash,parent,game:g.id,arm:a.id,rep,episodes:point,
        model,train,partial:null,started:point,validation,test});
      const f = checkpointPath(root,g,a,rep,point);
      assert.equal(bytes,fs.readFileSync(f,'utf8'), 'stock witness differs at '+rep+':'+point);
      parent = JSON.parse(bytes).hash;
      matches.push([rep,point]);
      done = point;
    }
  }
  return matches;
}

function worker(root, first, stride) {
  return new Promise((resolve,reject) => {
    const child = new Worker(new URL(import.meta.url),{workerData:{root,first,stride}});
    let matches;
    child.once('message', value => {matches = value;});
    child.once('error', reject);
    child.once('exit', status => {
      if (status === 0 && Array.isArray(matches)) resolve(matches);
      else reject(Error('stock diagnostic worker did not complete: '+status));
    });
  });
}

if (isMainThread) {
  const [mode, dir, option, ...rest] = process.argv.slice(2);
  assert.ok(dir && !rest.length && (
    (mode === '--lock' && option === undefined) || (mode === '--stage' && option) ||
    (mode === '--verify' && ['1','2','4'].includes(option))
  ), 'usage: stock-in-memory.mjs --lock STOCK_RUN | --stage STOCK_RUN NEW_STAGE | --verify STOCK_RUN 1|2|4');
  const root = path.resolve(dir), manifest = unseal(manifestPath(root));
  checkIdentity(manifest);
  const snapshot = checkedSnapshot(root,manifest);
  if (mode === '--stage') {
    fs.mkdirSync(option);
    for (const [name,bytes] of snapshot) {
      if (name.endsWith('.bend')) fs.writeFileSync(path.join(option,name),bytes,{flag:'wx'});
    }
  } else {
    status(root,true);
    if (mode === '--lock') console.log(JSON.stringify(checkCounts(root,manifest)));
    else {
      const workers = Number(option);
      const matches = workers === 1 ? await compareShard(root,manifest,0,1)
        : (await Promise.all(Array.from({length:workers}, (_,i) => worker(root,i,workers)))).flat();
      matches.sort(([r,p],[s,q])=>r-s || p-q);
      const plan = manifest.body.plan;
      assert.deepEqual(matches,Array.from({length:plan.replicates},(_,r)=>plan.checkpoints.map(p=>[r,p])).flat());
      console.log(matches.length + ' complete checkpoint files matched the stock archived bytes. No native archive written.');
    }
  }
} else {
  const {root,first,stride} = workerData;
  const manifest = unseal(manifestPath(root));
  checkIdentity(manifest); // Parent checked the immutable source bytes before spawning.
  parentPort.postMessage(await compareShard(root,manifest,first,stride));
}
