// Read-only, fixed one-checkpoint diagnostic. Never writes an archive.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, digest, seedOf, settings} from '../../../core/experiment_config.mjs';
import {manifestPath, record, seal, stats, status, unseal} from '../../../core/experiment.mjs';

const gate = JSON.parse(fs.readFileSync(new URL('./gate.json',import.meta.url),'utf8'));
const NIL = {$:'Nil'}, VACANT = {$:'Vacant'};
const maxWord = 0xffffffff;
const b = new DataView(new ArrayBuffer(4));
const word = n => (b.setFloat32(0,n),b.getUint32(0));
const f32 = n => (b.setUint32(0,n),b.getFloat32(0));
const isWord = n => Number.isInteger(n) && n>=0 && n<=maxWord;
const rowPath = (root, point) =>
  path.join(root,'trials',gate.game,gate.arm,String(gate.replicate),String(point)+'.json');

function encode(model, config) {
  assert.equal(model.$,'Agent');
  assert.deepEqual(model.settings,config);
  assert.equal(model.values.$,'Con');
  assert.equal(model.values.head.$,'Indexed');
  assert.deepEqual(model.values.tail,NIL);
  const rows=[];
  function visit(node,depth=0) {
    if(node.$==='Vacant') return maxWord;
    assert.equal(node.$,'Node');
    const {s,a,cell,lo,hi}=node;
    assert.equal(cell.$,'Cell');
    assert.ok(Number.isFinite(cell.value) && Object.is(Math.fround(cell.value),cell.value));
    assert.ok([s,a,cell.visits].every(isWord) && depth<=64 && rows.length<4096);
    const i=rows.length;
    rows.push(null);
    rows[i]=[s,a,cell.visits,word(cell.value),visit(lo,depth+1),visit(hi,depth+1)];
    return i;
  }
  assert.equal(visit(model.values.head.tree),0);
  return rows;
}
function decode(rows,config) {
  assert.ok(Array.isArray(rows) && rows.length>0 && rows.length<=4096);
  const seen=new Set();
  function visit(i,depth=0) {
    if(i===maxWord) return VACANT;
    assert.ok(isWord(i) && i<rows.length && !seen.has(i) && depth<=64);
    seen.add(i);
    const row=rows[i];
    assert.ok(Array.isArray(row) && row.length===6 && row.every(isWord));
    const [s,a,visits,bits,lo,hi]=row, value=f32(bits);
    assert.ok(Number.isFinite(value));
    return {$:'Node',s,a,cell:{$:'Cell',visits,value},lo:visit(lo,depth+1),hi:visit(hi,depth+1)};
  }
  const tree=visit(0);
  assert.equal(seen.size,rows.length);
  return {$:'Agent',settings:config,values:{$:'Con',head:{$:'Indexed',tree},tail:NIL}};
}

function trusted(root) {
  const m=unseal(manifestPath(root)), p=m.body.plan;
  assert.equal(m.hash,gate.parentManifest);
  assert.equal(digest(canonical(p)),gate.normalizedPlanSha256);
  assert.equal(m.body.toolchain.node,process.versions.node);
  assert.equal(m.body.toolchain.bend,'bend 2.0.40');
  assert.equal(p.budgetUnit,'episodes');
  assert.equal(gate.replicate,0);
  const report=status(root,true);
  assert.equal(report.savedCheckpoints,3600);
  const g=p.games.find(x=>x.id===gate.game), a=p.arms.find(x=>x.id===gate.arm);
  assert.ok(g?.definition && a?.method==='q_learning' && a.observation==='current');
  const from=gate.fromCheckpoint, to=gate.toCheckpoint;
  assert.equal(p.checkpoints[p.checkpoints.indexOf(from)+1],to);
  assert.ok(to<p.checkpoints.at(-1),'fixed witness intentionally targets a non-final checkpoint');
  const previous=unseal(rowPath(root,from)), next=unseal(rowPath(root,to));
  assert.equal(previous.body.experiment,m.hash);
  assert.equal(previous.body.partial,null);
  assert.equal(previous.body.started,from);
  assert.equal(previous.body.train.episodes,from);
  assert.equal(next.body.parent,previous.hash);
  assert.equal(next.body.test,null);
  const config=settings(a,g);
  const trainStart=seedOf(p,gate.replicate,'train')+from;
  const validationBase=seedOf(p,gate.replicate,'validation');
  const work={schema:1,parentManifest:m.hash,sourceCheckpoint:previous.hash,game:gate.game,arm:gate.arm,
    replicate:gate.replicate,from,to,trainStart,validationBase};
  return {previous,next,config,work,tag:digest(canonical(work)),p,g};
}

function generate(root, destination, input) {
  const dir=fs.realpathSync(path.dirname(path.resolve(destination)));
  const r=path.relative(fs.realpathSync(root),dir);
  assert.ok(r==='..' || r.startsWith('..'+path.sep) || path.isAbsolute(r),
    'place the generated C outside the archive');
  const temp=fs.mkdtempSync(path.join(dir,'.continuation-'));
  let source;
  try {
    const gen=path.join(temp,'kernel.c');
    execFileSync(process.execPath,[fileURLToPath(new URL('../parity.mjs',import.meta.url)),
      'generate-cell',root,gate.game,gate.arm,'1',gen],{timeout:15000,stdio:'inherit'});
    source=fs.readFileSync(gen,'utf8');
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
  const cells=encode(input.previous.body.model,input.config);
  assert.deepEqual(decode(cells,input.config),input.previous.body.model);
  const {work}=input;
  const data=[
    '#define CONTINUATION_HASH '+JSON.stringify(input.tag),
    '#define CONTINUATION_FIRST_SEED '+work.trainStart+'u',
    '#define CONTINUATION_TRAIN_COUNT '+(work.to-work.from)+'u',
    '#define CONTINUATION_VALIDATION_SEED '+work.validationBase+'u',
    'static const uint32_t resume_rows[][6] = {',
    ...cells.map(row=>'  {'+row.map(n=>n+'u').join(', ')+'},'),
    '};',
  ].join('\n');
  const suffix=fs.readFileSync(new URL('./entry.c',import.meta.url),'utf8');
  const c='#define main witness_whole_plan_entry\n'+source+'\n#undef main\n'+
    suffix.replace('/* CONTINUATION DATA */',data);
  fs.writeFileSync(destination,c,{flag:'wx'});
}
function addReports(base,rows,n,horizon) {
  assert.ok(Array.isArray(rows) && rows.length===n);
  for (const row of rows) {
    assert.ok(Array.isArray(row) && row.length===3 && row.every(isWord));
    const [score,steps,terminal]=row;
    assert.ok(steps<=horizon && (terminal===0 || terminal===1));
    record(base,{score:f32(score),steps,reason:{$:terminal?'Terminal':'Limit'}});
  }
  return base;
}
function compare(root,exe,input) {
  const raw=execFileSync(path.resolve(exe),[],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  const [tag,payload,...rest]=raw.trimEnd().split('\n');
  assert.equal(tag,input.tag,'native wire bound to a different source checkpoint or selection');
  assert.deepEqual(rest,[]);
  const rows=JSON.parse(payload);
  assert.ok(Array.isArray(rows) && rows.length===4);
  const [before,tr,va,after]=rows, {work,previous,next,config,p,g}=input;
  assert.deepEqual(decode(before,config),previous.body.model,'rehydrated starting model differs');
  const train=addReports(structuredClone(previous.body.train),tr,work.to-work.from,g.limit);
  const validation=addReports(stats(),va,p.validationEpisodes,g.limit);
  const body={experiment:work.parentManifest,parent:previous.hash,game:work.game,arm:work.arm,
    rep:work.replicate,episodes:work.to,model:decode(after,config),train,partial:null,
    started:work.to,validation,test:null};
  if(!Buffer.from(seal(body),'utf8').equals(fs.readFileSync(rowPath(root,work.to)))) {
    for(const k of Object.keys(body)) assert.deepEqual(body[k],next.body[k],'checkpoint differs in '+k);
    assert.fail('complete checkpoint bytes differ');
  }
  console.log(JSON.stringify({matchedCheckpoint:next.hash,initialCheckpoint:previous.hash,
    ...work,restoredIndexedNodes:before.length,appendedTrainReports:tr.length,validationReports:va.length,
    testReports:0,parentArchiveWritten:false}));
}

const [mode,root,destination,...rest]=process.argv.slice(2);
assert.ok(['generate','check'].includes(mode) && root && destination && !rest.length,
  'usage: witness.mjs generate TRUSTED_PARENT NEW_C | check TRUSTED_PARENT TRUSTED_NATIVE_EXE');
const input=trusted(root);
if(mode==='generate') generate(root,destination,input);
else compare(root,destination,input);
