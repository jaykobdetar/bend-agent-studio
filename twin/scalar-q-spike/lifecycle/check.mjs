// One fixed literal-Q scratch handoff. No production writer or native resume.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {canonical, digest} from '../../../core/experiment_config.mjs';
import {checkedSnapshot, manifestPath, unseal} from '../../../core/experiment.mjs';
import {collectVerifiedCheckpoints} from '../parity.mjs';

const lock=JSON.parse(fs.readFileSync(new URL('./gate.json',import.meta.url),'utf8'));
const [rawStock,exe,rawScratch,...rest]=process.argv.slice(2);
assert.ok(rawStock && exe && rawScratch && !rest.length,
  'usage: check.mjs TRUSTED_LITERAL_Q_ARCHIVE TRUSTED_NATIVE_EXE NEW_PRIVATE_SCRATCH');
const stock=fs.realpathSync(rawStock);
const scratch=path.join(fs.realpathSync(path.dirname(path.resolve(rawScratch))),path.basename(rawScratch));
const relative=path.relative(stock,scratch);
assert.ok(relative.startsWith('..'+path.sep) || path.isAbsolute(relative),'scratch must be outside stock');
assert.ok(!fs.existsSync(scratch),'scratch path must be new');
const rowPath=({game,arm,rep,point})=>['trials',game,arm,String(rep),point+'.json'].join('/');
function list(root,rel='') {
  return fs.readdirSync(path.join(root,rel),{withFileTypes:true}).flatMap(e=>{
    const f=path.posix.join(rel,e.name);
    if(e.isDirectory()) return list(root,f);
    assert.ok(e.isFile(),'unexpected archive filesystem entry');
    return [f];
  });
}
function fingerprint(root) {
  return digest(canonical(list(root).sort().map(name=>{
    const data=fs.readFileSync(path.join(root,name));
    return [name,data.length,digest(data)];
  })));
}
function cli(root,cmd,...args) {
  return execFileSync(process.execPath,[path.join(root,'code','experiment.mjs'),cmd,root,...args],
    {timeout:15000,maxBuffer:1024*1024});
}
function verify(root,expected) {
  const s=JSON.parse(cli(root,'verify'));
  assert.equal(s.completeTrials,lock.replicates);
  assert.equal(s.savedCheckpoints,expected);
  assert.equal(s.totalCheckpoints,expected);
}
const pristine=fingerprint(stock);
try {
  const manifestBytes=fs.readFileSync(manifestPath(stock)), m=unseal(manifestPath(stock)), p=m.body.plan;
  assert.equal(m.hash,lock.stockManifest);
  assert.equal(p.name,lock.plan);
  assert.equal(p.replicates,lock.replicates);
  assert.deepEqual(p.checkpoints,lock.checkpoints);
  assert.equal(p.games[0].id,lock.game);
  assert.equal(p.arms[0].id,lock.arm);
  const code=checkedSnapshot(stock,m);
  const candidates=collectVerifiedCheckpoints(stock,exe); // still no scratch writes
  assert.equal(candidates.length,12);
  const expected=new Map(candidates.map(row=>[rowPath(row),row.bytes]));
  assert.equal(expected.size,candidates.length);
  const trialHash=createHash('sha256');
  for(const f of [...expected.keys()].sort()) trialHash.update(f).update('\0').update(expected.get(f));
  assert.equal(trialHash.digest('hex'),lock.stockTrialSetSha256);

  fs.mkdirSync(scratch,{mode:0o700}); // first write; all 12 candidate bytes passed
  function stage(name,rows) {
    const root=path.join(scratch,name);
    fs.mkdirSync(root,{mode:0o700});
    fs.mkdirSync(path.join(root,'code'),{mode:0o700});
    for(const [file,bytes] of code) {
      assert.equal(path.basename(file),file);
      fs.writeFileSync(path.join(root,'code',file),bytes,{flag:'wx',mode:0o600});
    }
    for(const row of rows) {
      const file=path.join(root,rowPath(row));
      fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      fs.writeFileSync(file,row.bytes,{flag:'wx',mode:0o600});
    }
    fs.writeFileSync(manifestPath(root),manifestBytes,{flag:'wx',mode:0o600});
    return root;
  }
  function compareAll(root) {
    const actual=list(root,'trials').sort();
    assert.deepEqual(actual,[...expected.keys()].sort());
    for(const f of actual) assert.ok(fs.readFileSync(path.join(root,f)).equals(expected.get(f)),f);
  }
  const complete=stage('complete',candidates);
  verify(complete,12);
  compareAll(complete);
  const r=lock.replay, replayArgs=[lock.game,lock.arm,String(r.replicate),String(r.checkpoint),r.phase,String(r.index)];
  const replay=cli(complete,'replay',...replayArgs);
  assert.ok(replay.equals(cli(stock,'replay',...replayArgs)),'archived replay bytes differ');

  const prefix=candidates.filter(row=>row.point<=lock.prefixEndsAt);
  assert.equal(prefix.length,6);
  const resumable=stage('prefix',prefix);
  assert.deepEqual(list(resumable,'trials').sort(),prefix.map(rowPath).sort());
  assert.equal(cli(resumable,'resume').toString().trim(),lock.plan+': 3 trials visited, 6 checkpoints written.');
  verify(resumable,12);
  compareAll(resumable);
  console.log(JSON.stringify({sameStockManifest:m.hash,matchedBeforeStaging:candidates.length,
    completeVerified:12,replay:r,replaySha256:digest(replay),prefixFilesBeforeResume:prefix.length,
    stockResumeCreated:6,resumedFilesMatched:12,referenceFingerprint:pristine}));
} finally {
  assert.equal(fingerprint(stock),pristine,'untouched verified stock archive changed');
}
