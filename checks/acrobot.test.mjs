import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {compilerTest} from './support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dt = 0.2;
const caps = [4 * Math.PI, 9 * Math.PI];

// Independent F64 reference: solve the two-by-two mass matrix with
// Cramer's rule. The Bend implementation instead eliminates the first row.
function derivative([a, b, u, v], torque) {
  const link = 1,
    m1 = 1,
    m2 = 1,
    c1 = 0.5,
    c2 = 0.5,
    i1 = 1,
    i2 = 1,
    gravity = 9.8;
  const h00 = i1 + i2 + m1 * c1 ** 2 + m2 * (link ** 2 + c2 ** 2 + 2 * link * c2 * Math.cos(b));
  const h01 = i2 + m2 * (c2 ** 2 + link * c2 * Math.cos(b));
  const h11 = i2 + m2 * c2 ** 2;
  const grav2 = m2 * c2 * gravity * Math.sin(a + b);
  const grav1 = (m1 * c1 + m2 * link) * gravity * Math.sin(a) + grav2;
  const cross = m2 * link * c2 * Math.sin(b);
  const f0 = cross * (v * v + 2 * u * v) - grav1;
  const f1 = torque - cross * u * u - grav2;
  const det = h00 * h11 - h01 * h01;
  return [u, v, (h11 * f0 - h01 * f1) / det, (h00 * f1 - h01 * f0) / det];
}
function wrap(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}
function reference(state, action) {
  const torque = action - 1;
  const shift = (slope, step) => state.map((x, i) => x + step * slope[i]);
  const s1 = derivative(state, torque);
  const s2 = derivative(shift(s1, dt / 2), torque);
  const s3 = derivative(shift(s2, dt / 2), torque);
  const s4 = derivative(shift(s3, dt), torque);
  const update = state.map((x, i) => x + (dt / 6) * (s1[i] + 2 * (s2[i] + s3[i]) + s4[i]));
  update[0] = wrap(update[0]);
  update[1] = wrap(update[1]);
  for (let i = 0; i < 2; i++) update[i + 2] = Math.max(-caps[i], Math.min(caps[i], update[i + 2]));
  return update;
}
const coordinates = ({theta1, theta2, velocity1, velocity2}) => [
  theta1,
  theta2,
  velocity1,
  velocity2,
];
const encode = ([theta1, theta2, velocity1, velocity2]) => ({
  $: 'Acrobot',
  theta1,
  theta2,
  velocity1,
  velocity2,
});
const terminal = ([a, b]) => -Math.cos(a) - Math.cos(a + b) > 1;
const sequence = [
  {start: [0.03, -0.075, 0.04, -0.06], actions: [0, 2, 2, 1, 0, 1, 0, 2, 1]},
  {start: [-1.56, 0.28, 0.48, -0.25], actions: [1, 2, 0, 2, 2, 1]},
  {start: [3.08, -3.07, 4.4, -10.15], actions: [1, 0, 2]},
  {start: [-2.2, 2.65, -12.49, 28.17], actions: [2, 1]},
  {start: [Math.fround(Math.PI), 0, 0, 0], actions: [1]},
];
function check(actual, expected, label) {
  const closeAngle = (a, b) =>
    Math.min(Math.abs(a - b), Math.abs(a + 2 * Math.PI - b), Math.abs(a - 2 * Math.PI - b));
  for (const [i, value] of actual.entries()) {
    const gap = i < 2 ? closeAngle(value, expected[i]) : Math.abs(value - expected[i]);
    // RK4 in F32 vs F64; independent of exact matching of float rounding.
    assert.ok(gap < 0.00016, `${label}: component ${i}, expected ${expected[i]}, got ${value}`);
  }
}
test(
  'compiled Acrobot dynamics agree with a double-precision mass-matrix reference',
  compilerTest,
  async (t) => {
    const bin = process.env.BEND ?? 'bend';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-acrobot-check-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    for (const filename of ['engine.bend', 'parameters.bend'])
      fs.copyFileSync(path.join(root, 'core', filename), path.join(dir, filename));
    fs.copyFileSync(path.join(root, 'worlds/acrobot.bend'), path.join(dir, 'acrobot.bend'));
    const executable = path.join(dir, 'acrobot.mjs');
    execFileSync(bin, [path.join(dir, 'acrobot.bend'), '-o', executable], {
      env: {...process.env, BEND_NO_TELEMETRY: '1'},
    });
    const robot = (await import(pathToFileURL(executable).href)).default;
    assert.deepEqual(robot.reset(101), robot.reset(101));
    assert.notDeepEqual(robot.reset(101), robot.reset(102));
    for (let seed = 0; seed < 64; seed++)
      assert.ok(
        coordinates(robot.reset(seed)).every(
          (x) => x >= Math.fround(-0.1) && x <= Math.fround(0.1),
        ),
      );
    assert.deepEqual(robot.view(encode([0, 0, 0, 0])).actions, {
      $: 'Con',
      head: 0,
      tail: {$: 'Con', head: 1, tail: {$: 'Con', head: 2, tail: {$: 'Nil'}}},
    });
    // Optional second oracle; no dependency or skipped test in the default suite.
    const gymPython = process.env.BEND_ACROBOT_GYM_PYTHON;
    const gym = gymPython
      ? JSON.parse(
          execFileSync(
            gymPython,
            [
              '-c',
              `
import json
import sys

import gymnasium
import numpy as np
from gymnasium.envs.classic_control.acrobot import AcrobotEnv

if gymnasium.__version__ != "1.4.0":
    raise RuntimeError("Acrobot cross-check requires the repository's pinned Gymnasium 1.4.0")
env = AcrobotEnv()
trajectories = []
try:
    for trace in json.load(sys.stdin):
        env.reset(seed=0)
        env.state = np.asarray(trace["start"], dtype=np.float32)
        frames = []
        for action in trace["actions"]:
            _, reward, done, truncated, _ = env.step(action)
            assert not truncated
            frames.append([env.state.tolist(), reward, done])
        trajectories.append(frames)
finally:
    env.close()
print(json.dumps(trajectories))
`,
            ],
            {input: JSON.stringify(sequence), encoding: 'utf8', timeout: 10000},
          ),
        )
      : null;
    for (const [i, {start, actions}] of sequence.entries()) {
      let expected = start.map(Math.fround),
        state = encode(expected);
      for (const [j, action] of actions.entries()) {
        expected = reference(expected, action);
        const next = robot.step(state, action, j);
        check(coordinates(next.fst), expected, `trajectory ${i}, step ${j}, action ${action}`);
        assert.equal(next.snd, terminal(expected) ? 0 : -1);
        assert.equal(robot.view(next.fst).$, terminal(expected) ? 'End' : 'Open');
        if (gym) {
          const [state, reward, done] = gym[i][j];
          check(
            coordinates(next.fst),
            state,
            `Gymnasium trajectory ${i}, step ${j}, action ${action}`,
          );
          assert.equal(next.snd, reward);
          assert.equal(robot.view(next.fst).$, done ? 'End' : 'Open');
        }
        assert.deepEqual(
          robot.step(state, action, 0xffffffff - j),
          next,
          'No torque noise in the default environment',
        );
        state = next.fst;
      }
    }
  },
);
