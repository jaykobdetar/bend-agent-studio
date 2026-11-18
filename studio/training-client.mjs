import { fork } from 'node:child_process';

export async function openTrainingHost(home, onLost) {
  const host = fork(new URL('./training-host.mjs', import.meta.url), [], {
    execArgv: [], detached: process.platform !== 'win32', windowsHide: true,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  const pending = new Map();
  let sequence = 0, ownsHome = false;
  function request(command, dir) {
    if (!host.connected) return Promise.reject(Error('Training host disconnected. Restart Studio.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      host.send({ id, command, dir }, err => {
        if (err && pending.delete(id)) reject(err);
      });
    });
  }
  host.on('message', ({ id, value, error }) => {
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (error) call.reject(Error(error));
    else call.resolve(value);
  });
  const disconnected = () => {
    if (ownsHome) onLost();
    for (const call of pending.values()) call.reject(Error('Training host disconnected. Restart Studio.'));
    pending.clear();
  };
  host.on('error', disconnected);
  host.once('disconnect', disconnected);
  const close = () => {
    ownsHome = false;
    if (host.connected) host.disconnect();
  };
  try { await request('lock', home); ownsHome = true; }
  catch (err) { close(); throw err; }
  return { request, close };
}
