// A separate event loop observes the Studio IPC connection even when training
// is CPU-bound. Only this process starts (and can stop) its compiler children.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {run} from '../core/experiment.mjs';
import {execute} from '../core/process_output.mjs';

if (!isMainThread) {
  const {dir, bend} = workerData;
  // The CLI waits for one compiler invocation at a time.
  const compile = async (_program, args) => {
    const reply = once(parentPort, 'message');
    parentPort.postMessage(args);
    const [result] = await reply;
    if (result.error) throw Error(result.error);
    return result.output;
  };
  await run(path.join(dir, 'plan.json'), path.join(dir, 'run'), ['--bend', bend], compile);
} else {
  const {DatabaseSync} = await import('node:sqlite');
  let db, task, probe, marker;
  const bend = process.env.BEND || 'bend';
  function stop(status) {
    if (!task) return;
    task.stopStatus ??= status;
    task.compiler?.kill('SIGKILL');
    task.worker.terminate();
  }
  function start(dir) {
    if (task) throw Error('Training is already in progress.');
    const scratch = fs.mkdtempSync(path.join(dir, 'tmp-'));
    const env = {
      ...process.env,
      TMPDIR: scratch,
      TMP: scratch,
      TEMP: scratch,
      BEND_NO_TELEMETRY: '1',
    };
    let worker;
    // Leave evidence if this supervisor itself is killed before it confirms cleanup.
    fs.writeFileSync(marker, JSON.stringify({run: path.basename(dir)}) + '\n', {flag: 'wx'});
    try {
      worker = new Worker(new URL(import.meta.url), {workerData: {dir, bend}, env});
    } catch (err) {
      fs.unlinkSync(marker);
      fs.rmSync(scratch, {recursive: true, force: true});
      throw err;
    }
    const current = {worker, dir};
    task = current;
    let failure;
    worker.on('error', (err) => {
      failure = err.message;
    });
    worker.on('message', (args) => {
      if (current.stopStatus) return;
      current.compiling = execute(bend, args, {env}, (child) => {
        current.compiler = child;
      })
        .then(
          (output) => ({output}),
          (err) => ({error: err.message}),
        )
        .then((reply) => {
          current.compiler = undefined;
          if (!current.stopStatus) worker.postMessage(reply);
        });
    });
    current.done = new Promise((resolve) => worker.once('exit', resolve)).then(async (code) => {
      // Wait for the direct child's close event and file cleanup as well as the JS worker.
      current.compiler?.kill('SIGKILL');
      await current.compiling;
      try {
        fs.unlinkSync(marker);
        fs.rmSync(scratch, {recursive: true, force: true});
        const status = current.stopStatus ?? (code === 0 ? 'ready' : 'failed');
        const error = {
          cancelled: 'Training cancelled.',
          interrupted: 'Studio stopped during training.',
          failed: failure || 'Runner exited with code ' + code,
        }[status];
        return {status, error};
      } finally {
        task = undefined;
      }
    });
    return current.done;
  }
  async function handle(command, dir) {
    switch (command) {
      case 'lock':
        marker = path.join(dir, 'training-active.json');
        db = new DatabaseSync(path.join(dir, 'studio-lock.sqlite'));
        try {
          // SQLite releases this OS-backed writer lock even on a machine restart.
          db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
        } catch (err) {
          if (err.errcode === 5)
            throw Error(
              'This Studio home is in use. Close its Studio or choose another BEND_STUDIO_HOME.',
            );
          throw err;
        }
        return;
      case 'version':
        probe ??= promisify(execFile)(bend, ['version'], {timeout: 5000, killSignal: 'SIGKILL'});
        try {
          return (await probe).stdout.trim();
        } finally {
          probe = undefined;
        }
      case 'run':
        return start(dir);
      case 'cancel':
        if (task?.dir === dir) stop('cancelled');
        return;
      case 'interrupt':
        if (task?.dir === dir) stop('interrupted');
        return;
      default:
        throw Error('Unknown training command.');
    }
  }
  process.on('message', async ({id, command, dir}) => {
    let reply;
    try {
      reply = {id, value: await handle(command, dir)};
    } catch (err) {
      reply = {id, error: err.message};
    }
    if (process.connected) process.send(reply, () => {});
  });
  process.once('disconnect', async () => {
    probe?.child.kill('SIGKILL');
    stop('interrupted');
    try {
      await Promise.allSettled([probe, task?.done]);
    } finally {
      db?.close();
    }
  });
  // Studio owns console shutdown. Closing IPC also handles a direct signal to this host.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (process.connected) process.disconnect();
    });
  }
}
