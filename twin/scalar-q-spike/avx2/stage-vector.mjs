import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const [base, output, ...rest] = process.argv.slice(2);
assert(base && output && !rest.length);
const original = fs.readFileSync(base, 'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'),
  'd2e3328d42ce40e61002a07e7919f012e0fcab5930b65f4d1283f1e71b097379');
assert.match(original, /^#define UNIFORM 1u$/m);
const start = original.indexOf('static void print_reports(');
const end = original.indexOf('static void print_tree(', start + 1);
assert(start >= 0 && end > start);
const replacement = fs.readFileSync(new URL('./lanes.inc', import.meta.url), 'utf8');
fs.writeFileSync(output, original.slice(0,start) + replacement + original.slice(end), {flag:'wx'});
