import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execute} from './process_output.mjs';
import {offPolicy} from './batch.mjs';
import {actionBuckets,checkEpisode,openDataset} from './dataset.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const bend=process.env.BEND??'bend';
const run=(script,...args)=>execute(process.execPath,[path.join(here,script),...args]);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,x)=>fs.writeFileSync(file,JSON.stringify(x,null,2));

test('known propensities, importance weights, support failures and zero matches',()=>{
  for (const buckets of [0,1,9,5000,65535,65536]) {
    const draws=[0,0,0], legal=[15,42,7];
    for (let word=0;word<65536;word++) draws[word<buckets?word%3:1]++;
    assert.deepEqual(actionBuckets(legal,42,buckets),draws);
  }
  const trial=(action,score)=>({score,frames:[{action,legal:[1,2],preferred:1,propensityBuckets:32768,observation:0}]});
  const known=offPolicy([trial(1,4),trial(2,-3)],()=>1,65536);
  assert.ok(Math.abs(known.ordinary-4)<1e-12);
  assert.deepEqual({...known,ordinary:4},{episodes:2,matched:1,unsupported:0,ess:1,ordinary:4,normalized:4});
  assert.equal(offPolicy([trial(2,-3)],()=>1,65536).normalized,null);
  assert.equal(offPolicy([trial(1,4)],()=>2,0).unsupported,1);
  const empty=offPolicy([{score:0,frames:[]}],()=>0,0);
  assert.equal(empty.ess,1); assert.equal(empty.normalized,0);
});

test('dataset verification validates adjacent observations, stop flags and propensities',()=>{
  const spec={epsilon:0.5}, f={observation:10,legal:[0,1],preferred:0,action:0,accepted:true,reward:1,
    nextObservation:11,nextLegal:[0,1],terminal:false,truncated:false,propensityBuckets:49152};
  const g={...f,observation:11,terminal:true,nextLegal:[]};
  const ep={seed:0,score:2,reason:'Terminal',frames:[f,g]};
  checkEpisode(ep,spec,0,2);
  for (const changes of [{observation:14},{truncated:true},{propensityBuckets:32},{nextLegal:[1]}]) {
    assert.throws(()=>checkEpisode({...ep,frames:[f,{...g,...changes}]},spec,0,2));
  }
});

test('fit uses only logged training rows, independently checks held-out data and reproduces online evaluation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bend-batch-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f=name=>path.join(dir,name);
  const plan=read(path.join(here,'experiments','dispatch-source.json'));
  plan.games[0].file=path.join(here,'worlds','dispatch.json');plan.replicates=2;
  write(f('plan.json'),plan);
  await run('experiment.mjs','run',f('plan.json'),f('source'),'--bend',bend);
  const logger=read(path.join(here,'experiments','dispatch-narrow.json'));
  logger.fitEpisodes=8;logger.holdoutEpisodes=12;
  write(f('log.json'),logger);
  await run('batch.mjs','collect',f('source'),f('log.json'),f('dataset'));
  await run('batch.mjs','verify',f('dataset'));
  const heldout=f('dataset/holdout/0.jsonl'), clean=fs.readFileSync(heldout);
  fs.writeFileSync(heldout,'invalid holdout');
  const fitSpec=path.join(here,'experiments','dispatch-fit.json');
  await run('batch.mjs','fit',f('dataset'),fitSpec,f('models'),'--bend',bend);
  assert.throws(()=>openDataset(f('dataset')).episodes('holdout',0),/checksum/);
  const spec={schema:1,name:'scoring',episodes:10,seeds:{start:logger.seeds.fit,stride:50}};
  write(f('score.json'),spec);
  const score=()=>run('batch.mjs','score',f('source'),f('dataset'),f('models'),f('score.json'),f('scores'));
  await assert.rejects(score(),/overlapping/);
  spec.seeds.start=800000000;write(f('score.json'),spec);
  await assert.rejects(score(),/checksum/);
  fs.writeFileSync(heldout,clean);await score();
  const body=id=>read(f('scores/trials/'+id+'/0.json')).body;
  assert.equal(body('fqi').sum,-60);assert.equal(body('fqi').unsupported,12);
  assert.equal(body('supported').sum,-20);assert.equal(body('supported').normalized,-2);
  assert.equal(body('supported').ess,12);
  const bytes=fs.readFileSync(f('scores/scores.csv'),'utf8');
  await score();assert.equal(fs.readFileSync(f('scores/scores.csv'),'utf8'),bytes);
});
