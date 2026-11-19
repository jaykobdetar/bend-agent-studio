import fs from 'node:fs';
import cp from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const repo = process.argv[2],
  d = process.argv[3],
  alt = process.execPath,
  env = {...process.env, BEND_STUDIO_HOME: d + '/studio-home'};
const {Client} = await import(new URL('file://' + repo + '/mcp/wire-client.test-helper.mjs'));
const c = new Client(repo + '/mcp/server.mjs', ['--workspace', d], {env});
const studio = cp.spawn(
  process.execPath,
  [
    repo + '/studio/server.mjs',
    '--port',
    '0',
    '--run',
    d + '/bridge',
    '--run',
    d + '/custom',
    '--replay-node',
    alt,
  ],
  {env},
);
try {
  const url = String((await once(studio.stdout, 'data'))[0]).match(/http:\S+/)[0];
  await c.init();
  async function call(n, a) {
    const r = (await c.call(n, a)).result;
    if (r.isError) throw Error(JSON.stringify(r.content));
    return r.structuredContent;
  }
  const listing = await (await fetch(url + '/api/runs')).json();
  console.log(
    'attached',
    listing.map((x) => [x.name, x.id]),
  );
  assert.deepEqual((await call('list_runs', {root: '.'})).runs.map((x) => x.name).sort(), [
    'bridge',
    'custom',
  ]);
  for (const [run, name, game, arm, checkpoint, phase, node] of [
    ['bridge', 'authored-bridge', 'bridge', 'q', 32, 'validation', alt],
    ['custom', 'cliff-sarsa', 'cliff', 'sarsa', 32, 'validation', process.execPath],
  ]) {
    const r = JSON.parse(
      cp.execFileSync(node, [
        d + '/' + run + '/code/experiment.mjs',
        'replay',
        d + '/' + run,
        game,
        arm,
        '0',
        String(checkpoint),
        phase,
        '0',
      ]),
    );
    const item =
      listing.find((x) => x.name === name) ||
      listing.find((x) => x.directory === d + '/' + run) ||
      listing.find((x) => x.name === run);
    const res = await fetch(
      url +
        '/api/runs/' +
        item.id +
        '/replay?' +
        new URLSearchParams({game, arm, rep: 0, point: checkpoint, phase, episode: 0}),
    );
    const a = await res.json();
    const m = await call('replay_episode', {
      run,
      game,
      arm,
      replicate: 0,
      checkpoint,
      phase,
      episode: 0,
    });
    for (const x of [a, m]) {
      assert.deepEqual(x.frames, r.frames);
      assert.equal(x.finalModel, r.finalModel);
    }
    console.log(run, r.score, r.finalModel);
  }
} finally {
  studio.kill();
  await c.close();
}
