import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {replay} from '../../../../core/experiment.mjs';
const root=process.argv[2],g='practice-suite',A='table-raw',B='table-wrapper-no-reflection';
for(const n of [0,1024,8192]){
 const get=arm=>JSON.parse(fs.readFileSync(path.join(root,'trials',g,arm,'0',n+'.json'))).body;
 const a=get(A),b=get(B);assert.deepEqual(a.model.values,b.model.values);assert.equal(b.model.reflect,false);
 for(const term of ['train','validation','test','started'])assert.deepEqual(a[term],b[term]);
 if(a.partial||b.partial){
   assert(a.partial&&b.partial);
   assert.deepEqual(a.partial.steps,b.partial.steps);assert.deepEqual(a.partial.score,b.partial.score);
 }
 for(const phase of ['validation',...(n===8192?['test']:[])]){
   for(const i of [0,3]){
     const [x,y]=await Promise.all([A,B].map(arm=>replay(root,g,arm,'0',String(n),phase,String(i))));
     for(const k of ['frames','score','reason','seed'])assert.deepEqual(x[k],y[k]);
   }
 }
}
console.log('Stock Q and reflect=0 wrapper values/statistics, partial steps/score and 8 replay traces matched.');
