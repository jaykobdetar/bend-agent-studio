// Generate a fresh, reproducible optional stress study; no large tables checked in.
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {stormReserve} from '../../worlds/challenges/storm-reserve/world.mjs';

if (process.argv.length !== 3) throw Error('usage: node storm-factorial.mjs <new directory>');
const dir = resolve(process.argv[2]); mkdirSync(dir);
for (const [i, [h,c]] of [[8,2],[8,8],[24,2],[24,8]].entries()) {
  const id = `reserve-${h}x${c}`, file = id + '.json';
  writeFileSync(join(dir,file), JSON.stringify(stormReserve(h,c).definition)+'\n', {flag:'wx'});
  for (const method of ['q','dyna']) {
    const plan = {
      schema:1, name:id+'-'+method, games:[{id,file,limit:h}],
      arms:[{id:method,method:method==='q'?'q_learning':'dyna_q',alpha:0.125,gamma:1,epsilon:0.25,
        ...(method==='dyna'?{planningSteps:5}:{})}],
      replicates:8, checkpoints:[0,256,1024,4096,16384], validationEpisodes:32, testEpisodes:256,
      seeds:{train:370000000+i*1000000,validation:1690000000+i*1000000,
        test:2990000000+i*1000000,stride:20000}
    };
    writeFileSync(join(dir,plan.name+'.json'), JSON.stringify(plan,null,2)+'\n', {flag:'wx'});
  }
}
