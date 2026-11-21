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
