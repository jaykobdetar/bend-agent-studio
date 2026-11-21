import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {compilerTest} from './support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test(
  'compiled chess matches perft references and adjudicates terminal scores',
  compilerTest,
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-chess-perft-'));
    const bin = path.join(dir, 'perft.mjs');
    function run(command, args, timeout) {
      const r = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        timeout,
        env: {...process.env, BEND_NO_TELEMETRY: '1'},
      });
      if (r.error) throw r.error;
      assert.equal(r.status, 0, r.stderr || r.stdout);
      return r.stdout;
    }
    try {
      run(process.env.BEND ?? 'bend', ['checks/chess_perft.bend', '-o', bin], 90_000);
      // Starting position, Kiwipete (castling), position 3 (en passant),
      // and position 4 (promotions), followed by terminal-state probes.
      // https://www.chessprogramming.org/Perft_Results
      const compiled = (await import(pathToFileURL(bin).href)).default;
      const counts = [];
      let result = compiled.main();
      for (; result.$ === 'Con'; result = result.tail) counts.push(result.head);
      assert.equal(result.$, 'Nil');
      assert.deepEqual(counts, [20, 400, 8902, 48, 2039, 97862, 2812, 264, 9467, 1, 1, 1, 1, 1]);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  },
);

test('compiled chess applies exact repetition, claims and clock rules', compilerTest, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-chess-draws-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bin = path.join(dir, 'draws.mjs');
  const r = spawnSync(process.env.BEND ?? 'bend', ['checks/chess_draws.bend', '-o', bin], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90_000,
    env: {...process.env, BEND_NO_TELEMETRY: '1'},
  });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const c = (await import(pathToFileURL(bin).href)).default;
  const options = (game) => {
    const state = c.position(game);
    assert.equal(state.$, 'Turn');
    const found = [];
    for (let list = state.legal; list.$ === 'Con'; list = list.tail) found.push(list.head);
    return found;
  };
  const action = (from, to) => from + 128 * to;
  const f6g8 = action(85, 118);
  const intendedThree = 131072 + f6g8;
  const noScore = {$: 'Outcome', first: 0};
  assert.ok(!options(c.reset()).some((a) => a >= 98304));
  const pre = c.before_third();
  assert.ok(options(pre).includes(f6g8));
  assert.ok(options(pre).includes(intendedThree));
  assert.ok(!options(pre).includes(98304));
  assert.deepEqual(c.position(c.step(pre, intendedThree)), noScore);
  assert.ok(options(c.step(pre, f6g8)).includes(98304));
  assert.deepEqual(c.position(c.step(c.repeat(2, c.reset()), 98304)), noScore);
  assert.ok(options(c.repeat(3, c.reset())).includes(98304));
  assert.deepEqual(c.position(c.repeat(4, c.reset())), noScore);

  const a1b1 = action(0, 1),
    b3b4 = action(33, 49);
  // Fixture has a white rook and pawn: quiet king move can satisfy an
  // intended claim, pawn move cannot, and the original action remains legal.
  const almost = options(c.fifty(99));
  assert.ok(almost.includes(a1b1));
  assert.ok(almost.includes(262144 + a1b1));
  assert.ok(almost.includes(b3b4));
  assert.ok(!almost.includes(262144 + b3b4));
  assert.ok(!almost.includes(98305));
  assert.ok(options(c.fifty(100)).includes(98305));
  assert.deepEqual(c.position(c.step(c.fifty(100), 98305)), noScore);
  assert.deepEqual(c.position(c.step(c.fifty(99), 262144 + a1b1)), noScore);
  assert.deepEqual(c.position(c.fifty(150)), noScore);

  assert.deepEqual(c.ep_key(true, 83), c.ep_key(true, 127));
  assert.notDeepEqual(c.ep_key(false, 83), c.ep_key(false, 127));
  assert.notDeepEqual(c.right_key(0), c.right_key(1));

  const board = (pieces) =>
    Object.assign(Object.fromEntries([...'abcdefgh'].map((r) => [r, 0])), {$: 'Ranks'}, pieces);
  // Two knights cannot force mate, but mate can occur with cooperation.
  assert.equal(c.no_mate(board({a: 6, h: 14})), true);
  assert.equal(c.no_mate(board({a: 38, h: 14})), true); // K+N vs K
  assert.equal(c.no_mate(board({a: 54, h: 14})), true); // K+B vs K
  assert.equal(c.no_mate(board({a: 197382, h: 14})), true); // two bishops on same color
  assert.equal(c.no_mate(board({a: 54, h: 14, c: 176})), true); // both colors' bishops, same squares' color
  assert.equal(c.no_mate(board({a: 54, h: 14, c: 11})), false); // opposite square colors
  assert.equal(c.no_mate(board({a: 550, h: 14})), false); // K+NN vs K
  assert.equal(c.no_mate(board({a: 806, h: 14})), false); // bishop + knight
  assert.equal(c.no_mate(board({a: 70, h: 14})), false); // rook
});
