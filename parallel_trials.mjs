// A responsive supervisor owns the CPU-bound shard runners. If its CLI parent
// disappears, IPC disconnect still reaches this idle event loop and stops them.
import {fork} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const outputLimit = 16384;
export async function launchShards(root, jobs, until, name, trialCount) {
  const count = Math.min(jobs, trialCount);
  const child = fork(path.join(root, 'code', 'parallel_trials.mjs'),
    [root, String(count), String(until)], {execArgv: [], stdio: ['ignore','inherit','inherit','ipc']});
  let result, failure;
  const stop = () => { failure ??= Error('parallel run interrupted'); if (child.connected) child.send('stop', () => {}); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await new Promise((resolve, reject) => {
      child.on('message', m => { if (m && typeof m === 'object') result = m; });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (failure || code !== 0 || !result || !Number.isSafeInteger(result.created) ||
            result.finished !== trialCount) {
          reject(failure ?? Error(result?.error ?? ('parallel supervisor exited ' + (signal ?? code))));
        } else resolve();
      });
    });
    return {name, finished: result.finished, created: result.created};
  } finally {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}

async function supervise(root, count, until) {
  if (!process.send || !Number.isInteger(count) || count < 1 || count > 32) throw Error('invalid shard supervisor invocation');
  const children = new Set();
  let failure, finished = 0, created = 0;
  function abort(error) {
    failure ??= error;
    for (const p of children) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  }
  process.on('disconnect', () => abort(Error('owner disconnected')));
  process.on('message', m => { if (m === 'stop') abort(Error('parallel run interrupted')); });
  process.once('SIGINT', () => abort(Error('parallel run interrupted')));
  process.once('SIGTERM', () => abort(Error('parallel run interrupted')));
  const tasks = [];
  for (let i = 0; i < count && !failure; i++) {
    const shard = i + '/' + count;
    const args = ['resume', root, '--shard', shard, ...(until === 'Infinity' ? [] : ['--until', until])];
    tasks.push(new Promise(resolve => {
      let p;
      try { p = fork(path.join(root, 'code', 'experiment.mjs'), args,
        {execArgv: [], stdio: ['ignore','pipe','pipe','ipc'], env: {...process.env, BEND_REPORT_SHARD: shard}}); }
      catch (e) { abort(e); resolve(); return; }
      children.add(p);
      let summary, stdout = '', stderr = '';
      p.stdout.on('data', b => { stdout = (stdout + b).slice(-outputLimit); });
      p.stderr.on('data', b => { stderr = (stderr + b).slice(-outputLimit); });
      p.on('message', m => { if (m?.shard === shard) summary = m; });
      p.on('error', e => abort(Error('shard ' + shard + ': ' + e.message)));
      p.once('close', (code, signal) => {
        children.delete(p);
        if (stdout.trim()) process.stdout.write('[' + shard + '] ' + stdout.trimEnd() + '\n');
        if (stderr.trim()) process.stderr.write('[' + shard + '] ' + stderr.trimEnd() + '\n');
        if (code !== 0 || !Number.isSafeInteger(summary?.finished) || !Number.isSafeInteger(summary?.created))
          abort(Error('shard ' + shard + ' failed (' + (signal ?? code) + ')'));
        else { finished += summary.finished; created += summary.created; }
        resolve();
      });
    }));
  }
  await Promise.all(tasks);
  if (process.connected) await new Promise(resolve => process.send(failure ? {error:failure.message} : {finished,created},resolve));
  if (process.connected) process.disconnect();
  if (failure) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  supervise(process.argv[2], Number(process.argv[3]), process.argv[4]).catch(e => {
    console.error(e.message); if (process.connected) process.disconnect(); process.exitCode = 1;
  });
