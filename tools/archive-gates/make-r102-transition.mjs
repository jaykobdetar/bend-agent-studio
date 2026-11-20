// Feed independent captures from the pinned predecessor and reviewed candidate.
// This only prints proposed changes; review them before redirecting to a fixture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const files = process.argv.slice(2);
assert.equal(
  files.length,
  4,
  'usage: node make-r102-transition.mjs OLD-SOURCES NEW-SOURCES OLD-BACKENDS NEW-BACKENDS',
);
const [before, after, oldBackends, newBackends] = files.map((f) =>
  JSON.parse(readFileSync(f, 'utf8')),
);
const keys = (x) => Object.keys(x).sort();
const sameKeys = (a, b, label) => assert.deepEqual(keys(a), keys(b), label);
const delta = (before, after) => ({before, after});
const diff = (a, b) =>
  Object.fromEntries(
    [...new Set([...keys(a), ...keys(b)])]
      .sort()
      .flatMap((k) => (a[k] === b[k] ? [] : [[k, delta(a[k] ?? null, b[k] ?? null)]])),
  );
const nonempty = (x) => keys(x).length > 0;
assert.equal(before.schema, 1);
assert.equal(after.schema, 1);
assert.equal(oldBackends.schema, 1);
assert.equal(newBackends.schema, 1);
assert.equal(oldBackends.bend, newBackends.bend);
sameKeys(oldBackends.backends, newBackends.backends, 'representative backend inventory');
sameKeys(before.plans, after.plans, 'training plan inventory');
const commonSources = diff(before.commonSources, after.commonSources);
for (const [name, d] of Object.entries(commonSources)) {
  // Moving into/out of the de-duplicated capture bucket is not a change
  // for all plans. Handle such names per plan using full map differences.
  if (d.before === null || d.after === null) delete commonSources[name];
}
const plans = {};
for (const name of keys(before.plans)) {
  const a = before.plans[name],
    b = after.plans[name],
    changes = {};
  const sources = diff(
    {...before.commonSources, ...a.sources},
    {...after.commonSources, ...b.sources},
  );
  for (const k of keys(commonSources)) {
    assert.deepEqual(sources[k], commonSources[k]);
    delete sources[k];
  }
  if (nonempty(sources)) changes.sources = sources;
  sameKeys(a.bundles, b.bundles, name + ' referenced bundle inventory');
  const bundles = {};
  for (const id of keys(a.bundles)) {
    const x = a.bundles[id],
      y = b.bundles[id],
      changes = {};
    if (x.entry !== y.entry) changes.entry = delta(x.entry, y.entry);
    const files = diff(x.files, y.files);
    if (nonempty(files)) changes.files = files;
    if (nonempty(changes)) bundles[id] = changes;
  }
  if (nonempty(bundles)) changes.bundles = bundles;
  assert.equal(a.plan !== b.plan, nonempty(bundles), name + ' unexpected plan change');
  if (a.plan !== b.plan) changes.plan = delta(a.plan, b.plan);
  if (nonempty(changes)) plans[name] = changes;
}
console.log(
  JSON.stringify(
    {
      schema: 1,
      predecessor: {
        commit: '032375733bb9559d77cea59b812654fd35d5bfe5',
        tree: '30ca2f4622e3c4a91a2a7539fb69525d928ba4bc',
      },
      commonSources,
      plans,
      backends: diff(oldBackends.backends, newBackends.backends),
    },
    null,
    2,
  ),
);
