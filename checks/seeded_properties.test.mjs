import test from 'node:test';
import {properties, defaults} from './seeded_properties.mjs';

test('bounded seeded properties for manifests, finite grids, memory, POMDP and workspace paths', () => {
  properties(defaults);
});
