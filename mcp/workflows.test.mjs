import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {context,repo} from './context.mjs';
import {jobs} from './jobs.mjs';
import {more} from './more.mjs';
import {authoring} from './authoring.mjs';
import {compilerTest} from '../bend_test_support.mjs';
const read=f=>JSON.parse(fs.readFileSync(f)),sample=n=>read(path.join(repo,'experiments',n+'.json'));
function fixture(t,repoMode=false){
 const root=fs.mkdtempSync(path.join(repoMode?repo:os.tmpdir(),'bend-mcp-flow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const ctx=context(repoMode?repo:root),tools={...jobs,...more,...authoring},write=(f,x)=>fs.writeFileSync(path.join(root,f),JSON.stringify(x));
 const call=(n,a)=>tools[n].run(a,ctx);
 async function run(n,a){const {jobId}=await call(n,a);let s;do{await new Promise(r=>setTimeout(r,75));s=await call('job_status',{jobId})}while(s.status==='running');assert.equal(s.status,'completed',s.lastStderr);return s}
 return {root,ctx,call,run,write};
}
test('memory composition, exact policy, examples, and sequential inference',async t=>{
 const {call,write,root}=fixture(t);
 for(const name of ['reward-cue','reward-memory-rules','bridge'])fs.copyFileSync(path.join(repo,'worlds',name+'.json'),path.join(root,name+'.json'));
 const args={world:'reward-cue.json',rules:'reward-memory-rules.json',out:'augmented'};
 const w=await call('build_memory_world',args);assert.deepEqual(w.world,read(path.join(root,'augmented/world.json')));await assert.rejects(call('build_memory_world',args),/exists/);
 const res=await call('evaluate_policy_exact',{world:'bridge.json',horizon:2,policy:{0:0,1:9,2:9},behavior:{0:[0.5,0.5],1:9,2:9}});assert.equal(res.expectedReturn,1);
 assert.ok((await call('list_examples',{})).examples.find(x=>x.path==='experiments/bridge.json'&&x.kind==='training plan'));
 write('design.json',{design:{lower:-1,upper:1},rows:[{replicate:0,candidate:1,reference:0}]});
 assert.equal((await call('sequential_test',{file:'design.json'})).meanDifference,1);
});
test('real Bend: check, train, resume, reproduce, verify, inspect, curves, assess, select, collect/fit/score', {...compilerTest,timeout:120000},async t=>{
 const {root,call,run,write}=fixture(t);
 fs.copyFileSync(path.join(repo,'agents/ucb.bend'),path.join(root,'ucb.bend'));
 assert.equal((await call('check_bend',{file:'ucb.bend'})).valid,true);
 const plan=sample('dispatch-source');plan.replicates=2;plan.games[0].file='dispatch.json';plan.arms.push({id:'uniform',method:'random'});plan.checkpoints=[0,1];
 fs.copyFileSync(path.join(repo,'worlds/dispatch.json'),path.join(root,'dispatch.json'));
 write('plan.json',plan);await run('start_run',{plan:'plan.json',out:'source',until:0});
 await run('resume_run',{run:'source'});await run('rerun',{run:'source',out:'reproduced'});
 assert.equal((await call('verify_run',{run:'source'})).verified,true);
 assert.equal((await call('list_runs',{root:'.'})).runs.filter(r=>r.verified).length,2);
 const c={run:'source',game:'dispatch',arm:'first',replicate:0,checkpoint:1};
 const row=await call('get_checkpoint',c);assert.ok(row.modelHash);assert.equal(row.model,undefined);assert.ok((await call('get_checkpoint',{...c,includeModel:true})).model);
 assert.equal((await call('learning_curve',{run:'source',draws:100})).series.length,2);
 write('assessment.json',{schema:1,name:'assessment',comparisons:[{id:'base',source:'dispatch',arm:'first',checkpoint:'final'}],targets:['dispatch'],episodes:2,seeds:{start:50000,stride:10}});
 await run('start_assessment',{run:'source',spec:'assessment.json',out:'assessment'});
 write('select.json',{...sample('car-confirmation'),reference:'first',replicates:2,checkpoints:[0,1],validationEpisodes:2,testEpisodes:2});
 assert.equal((await call('select_confirmation',{run:'source',spec:'select.json',out:'selected'})).plan.arms.length,2);
 write('collect.json',{...sample('dispatch-narrow'),fitEpisodes:4,holdoutEpisodes:4});
 await run('start_offline',{step:'collect',run:'source',spec:'collect.json',out:'dataset'});
 write('fit.json',sample('dispatch-fit'));await run('start_offline',{step:'fit',dataset:'dataset',spec:'fit.json',out:'models'});
 write('score.json',{...sample('dispatch-score'),episodes:4});
 await run('start_offline',{step:'score',run:'source',dataset:'dataset',models:'models',spec:'score.json',out:'scores'});
 assert.ok(fs.statSync(path.join(root,'scores/scores.csv')).size);
});
test('real Bend: arena tournament on a small shipped takeaway plan', {...compilerTest,timeout:60000},async t=>{
 const {root,call,run,write}=fixture(t,true);
 const p=sample('self-play');p.games=p.games.filter(g=>g.id==='takeaway');p.arms=p.arms.slice(0,1);p.replicates=1;p.checkpoints=[0];p.validationEpisodes=1;p.testEpisodes=1;
 p.games[0].worldFile=path.join(repo,'worlds/takeaway.bend');p.arms[0].agentFile=path.join(repo,'agents/self_play.bend');
 const out=path.join(root,'arena');write('self-play.json',p);await run('start_run',{plan:path.join(root,'self-play.json'),out});
 const result=await call('arena_tournament',{run:out});assert.equal(result.ratings.length,1);assert.equal(result.crossplay.length,1);
});
