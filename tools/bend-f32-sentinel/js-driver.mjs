import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const [, , generated, ...words] = process.argv;
assert(words.length > 0 && words.length % 2 === 0);
assert(words.every((text) => /^(0|[1-9][0-9]*)$/.test(text) && Number(text) <= 0xffffffff));
const {default: api} = await import(pathToFileURL(generated).href);
assert.equal(typeof api.row, 'function');
for (let i = 0; i < words.length; i += 2) {
  const row = api.row(Number(words[i]), Number(words[i + 1]));
  assert.equal(typeof row, 'string');
  process.stdout.write(row + '\n');
}
