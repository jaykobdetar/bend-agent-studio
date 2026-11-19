import test from 'node:test';
import assert from 'node:assert/strict';
import {checkInventory} from './docs_inventory.mjs';

test('count, manifest, doc-link, and CLI coverage fail independently',()=>{
  const facts={experiments:['bridge.json'],commands:['verify'],counts:{'core-laws':2}};
  const docs=new Map([
    ['README.md','<!-- count:core-laws -->2<!-- /count -->'],
    ['EXPERIMENTS.md','## Choose a manifest or specification\n| command | `bridge` |'],
    ['docs/commands.md','node experiment.mjs verify RUN']
  ]);
  const linked=new Set(['docs/commands.md']);
  assert.deepEqual(checkInventory(facts,docs,linked),[]);
  for(const [file,replacement,regex] of [
    ['README.md','<!-- count:core-laws -->1<!-- /count -->',/stale or unknown/],
    ['README.md','2',/missing count marker/],
    ['EXPERIMENTS.md','## Another section\n| `bridge` |',/manifest table missing bridge/],
    ['docs/commands.md','node experiment.mjs verifySomething RUN',/undocumented command verify/]
  ]){
    const broken=new Map(docs).set(file,replacement);
    assert.match(checkInventory(facts,broken,linked).join('\n'),regex);
  }
  assert.match(checkInventory(facts,docs,new Set()).join('\n'),/no inbound/);
});

test('legacy learner bookmarks link to a present canonical guide; current guides remain discoverable',()=>{
  const facts={experiments:[],commands:[],counts:{}},old='docs/linear.md',guide='agents/linear/README.md';
  const stub='<!-- moved-to: '+guide+' -->\n[New guide](../'+guide+')';
  const docs=new Map([[old,stub],[guide,'# Linear']]),incoming=new Set([guide]);
  assert.deepEqual(checkInventory(facts,docs,incoming),[]);
  assert.match(checkInventory(facts,new Map([[old,stub]]),incoming).join('\n'),/no inbound/);
  assert.match(checkInventory(facts,new Map(docs).set(old,'<!-- moved-to: '+guide+' -->'),incoming).join('\n'),/no inbound/);
  assert.match(checkInventory(facts,docs,new Set()).join('\n'),/agents\/linear\/README/);
});
