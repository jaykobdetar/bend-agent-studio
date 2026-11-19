import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {oracle, usesPackedWorld, worldDefinition} from '../../../core/finite_world.mjs';
import {stormReserve, reference, variants} from './world.mjs';

const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`);
test('small tree: prices, asymmetric reserve settlement and a non-myopic first move', () => {
  const w = worldDefinition(stormReserve(2, 2).definition);
  // For every root action, try each legal second action separately in each weather;
  // no reuse of oracle/value-iteration code for the hand-tree witness.
  const qs = w.states[1].actions.map(a => a.outcomes.reduce((v, x) =>
    v + x.weight/8 * (x.reward + Math.max(...w.states[x.to].actions.map(k => k.outcomes[0].reward))), 0));
  assert.deepEqual(qs, [0.25, 0.75, -2.375]);
  assert.deepEqual(reference(2, 2), {optimal: 0.75, myopic: 0.25, noTrade: 0});
  assert.deepEqual(stormReserve(1, 2).definition.states[1].actions.map(a => a.outcomes[0].reward), [0,-1,-6]);
});
test('every row is reachable; storage, weather and clock advance correctly', () => {
  for (const [h, c] of [[1,2], [5,3], ...variants]) {
    const {definition, rows, reserve} = stormReserve(h, c);
    const w = worldDefinition(definition);
    const visited = new Set(w.initial.map(x => x.to));
    for (const s of w.states.slice(1)) {
      assert.ok(visited.has(s.id));
      assert.equal(s.observation, s.id);
      const [t, q, wth] = rows[s.id];
      const expectedPrices = [1,4,9], expectedWeather = [[5,2,1],[2,4,2],[1,3,4]];
      const legal = [0, ...(q < c ? [1] : []), ...(q ? [2] : [])];
      assert.deepEqual(s.actions.map(a => a.id), legal);
      for (const a of s.actions) {
        const nq = q + [0,1,-1][a.id];
        const cash = [0,-expectedPrices[wth]-1,expectedPrices[wth]][a.id];
        if (t === h - 1) {
          assert.deepEqual(a.outcomes, [{to:0,weight:1,reward:cash+(nq<reserve?7:1)*(nq-reserve)}]);
        } else {
          assert.deepEqual(a.outcomes.map(x => x.weight), expectedWeather[wth]);
          for (const [j,x] of a.outcomes.entries()) {
            assert.equal(x.reward, cash);
            assert.deepEqual(rows[x.to], [t+1,nq,j]);
          }
        }
        for (const x of a.outcomes) visited.add(x.to);
      }
    }
    assert.equal(visited.size, w.states.length);
    assert.deepEqual(w.states[0].actions, []);
  }
});
test('generic full-state and occupancy-specific backwards solutions agree; controls and backend boundary', () => {
  for (const [h,c] of [[1,2], [4,3], ...variants, [17,6]]) {
    const w = worldDefinition(stormReserve(h,c).definition), r = reference(h,c), o = oracle(w,h);
    approx(r.optimal, o.optimalFullStateReturn);
    assert.ok(r.optimal >= r.myopic);
    assert.ok(r.optimal >= r.noTrade);
    assert.ok(r.optimal >= o.uniformReturn);
  }
  assert.deepEqual(variants.map(([h,c]) => usesPackedWorld(stormReserve(h,c).definition)), [false,true]);
});
test('generated fixtures are current and configuration is bounded', () => {
  for (const args of [[0,2], [2,1], [97,2], [2,25], [2.5,4]]) {
    assert.throws(() => stormReserve(...args), /integer/);
    assert.throws(() => reference(...args), /integer/);
  }
  execFileSync(process.execPath,[fileURLToPath(new URL('generate.mjs',import.meta.url)),'--check']);
});
