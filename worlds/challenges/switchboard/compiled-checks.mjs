import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compilerTest } from '../../../checks/support.mjs';
import { encodings, switchboard } from './switchboard.mjs';

const cli = fileURLToPath(new URL('../../../experiment.mjs', import.meta.url));
const source = fileURLToPath(new URL('./switchboard.bend', import.meta.url));
const command = (runner, ...args) =>
  execFileSync(process.execPath, [runner, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
  });

test(
  'compiled finite and compact worlds preserve matched traces, models and phase metrics',
  compilerTest,
  (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-compiled-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    // No-delay literal and delayed packed paths; use identical phase seed blocks.
    for (const [width, delay] of [
      [2, 0],
      [4, 8],
    ]) {
      const games = encodings.flatMap((encoding, index) => {
        const { definition, horizon } = switchboard(width, delay, encoding);
        return [
          { id: 'finite-' + encoding, limit: horizon, definition },
          {
            id: 'native-' + encoding,
            limit: horizon,
            worldFile: source,
            parameters: { width, delay, encoding: index },
          },
        ];
      });
      const plan = {
        schema: 1,
        name: 'switchboard-parity-' + width,
        games,
        arms: [
          {
            id: 'q',
            method: 'q_learning',
            epsilon: 0.125,
            alpha: 0.25,
            gamma: 1,
          },
        ],
        replicates: 1,
        checkpoints: [0, 32],
        validationEpisodes: 32,
        testEpisodes: 32,
        seeds: { train: 7, validation: 23512, test: 327293, stride: 64 },
      };
      const manifest = path.join(tmp, 'plan-' + width + '.json');
      const root = path.join(tmp, 'run-' + width);
      fs.writeFileSync(manifest, JSON.stringify(plan));
      command(cli, 'run', manifest, root, '--bend', process.env.BEND ?? 'bend');
      const runner = path.join(root, 'code', 'experiment.mjs');
      for (const encoding of encodings) {
        function payload(kind, checkpoint) {
          const { game, parent, ...body } = JSON.parse(
            fs.readFileSync(
              path.join(
                root,
                'trials',
                kind + '-' + encoding,
                'q',
                '0',
                checkpoint + '.json',
              ),
              'utf8',
            ),
          ).body;
          return body;
        }
        assert.deepEqual(payload('finite', 0), payload('native', 0));
        assert.deepEqual(payload('finite', 32), payload('native', 32));
        for (const [checkpoint, phase, index] of [
          [0, 'train', 0],
          [0, 'train', 31],
          [0, 'validation', 7],
          [32, 'test', 17],
          [32, 'test', 29],
        ]) {
          function trace(kind) {
            const { game, ...rest } = JSON.parse(
              command(
                runner,
                'replay',
                root,
                kind + '-' + encoding,
                'q',
                '0',
                String(checkpoint),
                phase,
                String(index),
              ),
            );
            return rest;
          }
          assert.deepEqual(trace('finite'), trace('native'), {
            width,
            delay,
            encoding,
            phase,
            index,
          });
        }
      }
    }
  },
);

// Independent word recurrence and arithmetic interval decoder. No explicit
// width-16 table is generated or compiled.
function width16Reference(seed, delay) {
  const step = (x) => (Math.imul(x, 1664525) + 1013904223) >>> 0;
  function mix(x) {
    x = Math.imul(x ^ (x >>> 16), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    return (x ^ (x >>> 16)) >>> 0;
  }
  const cues = [Math.floor(mix(seed ^ 3266489917) / 2 ** 31)];
  let word = step(seed);
  const observations = [];
  let memory = 0;
  let query = null;
  for (let i = 0; i < 16 + delay; i++) {
    const draw = mix(step(word) ^ 2779096485);
    if (i < 16) {
      observations.push(50 * memory + 2 * i + cues[i]);
      memory += cues[i] * 2 ** i;
    } else {
      observations.push(50 * memory + 32);
    }
    if (i < 15) cues.push(Math.floor(draw / 2 ** 31));
    if (i === 15 + delay) query = Math.floor(draw / 2 ** 28);
    word = step(step(word));
  }
  observations.push(50 * memory + 33 + query);
  return {
    observations,
    query,
    answer: cues[query],
    terminalObservation: 50 * memory + 49,
  };
}

test(
  'the compact width-16 world matches an independent trace at every query index',
  compilerTest,
  (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-wide-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const manifest = path.join(tmp, 'manifest.json');
    const root = path.join(tmp, 'run');
    const delay = 3;
    const horizon = 17 + delay;
    const validation = 23512;
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schema: 1,
        name: 'switchboard-wide-test',
        games: [
          {
            id: 'wide-full',
            limit: horizon,
            worldFile: source,
            parameters: { width: 16, delay, encoding: 2 },
          },
        ],
        arms: [{ id: 'random', method: 'random' }],
        replicates: 1,
        checkpoints: [0],
        validationEpisodes: 256,
        testEpisodes: 0,
        seeds: { train: 7, validation, test: 327293, stride: 512 },
      }),
    );
    command(cli, 'run', manifest, root, '--bend', process.env.BEND ?? 'bend');
    const runner = path.join(root, 'code', 'experiment.mjs');
    const indexes = new Set();
    for (let i = 0; i < 256; i++) {
      const ref = width16Reference(validation + i, delay);
      if (indexes.has(ref.query)) continue;
      indexes.add(ref.query);
      const trace = JSON.parse(
        command(
          runner,
          'replay',
          root,
          'wide-full',
          'random',
          '0',
          '0',
          'validation',
          String(i),
        ),
      );
      assert.equal(trace.steps, horizon);
      assert.deepEqual(trace.reason, { $: 'Terminal' });
      assert.deepEqual(
        trace.frames.map((frame) => frame.observation),
        ref.observations,
      );
      for (let j = 0; j < horizon - 1; j++) {
        assert.deepEqual(trace.frames[j].legal, [2]);
        assert.equal(trace.frames[j].action, 2);
        assert.equal(trace.frames[j].reward, 0);
        assert.equal(trace.frames[j].nextObservation, ref.observations[j + 1]);
        assert.equal(trace.frames[j].terminal, false);
      }
      const last = trace.frames.at(-1);
      assert.deepEqual(last.legal, [0, 1]);
      assert.equal(last.reward, last.action === ref.answer ? 1 : -1);
      assert.equal(last.reward, trace.score);
      assert.equal(last.nextObservation, ref.terminalObservation);
      assert.equal(last.terminal, true);
      assert.equal(last.truncated, false);
    }
    assert.deepEqual(
      [...indexes].sort((a, b) => a - b),
      Array.from({ length: 16 }, (_x, i) => i),
    );
  },
);
