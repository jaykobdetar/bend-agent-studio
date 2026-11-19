// Read/copy/verify data only. Never imports or executes the archived backend.
import fs from 'node:fs';
import path from 'node:path';
import {openDataset} from '../../offline/dataset.mjs';
const [source, destination] = process.argv.slice(2);
let total = 0;
function copy(name) {
  const file = path.join(source, name),
    st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 64 * 1024 * 1024)
    throw Error('source must be a bounded regular file: ' + name);
  total += st.size;
  if (total > 128 * 1024 * 1024) throw Error('source exceeds 128 MiB');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== st.size) throw Error('source changed while reading');
  fs.mkdirSync(path.dirname(path.join(destination, name)), {recursive: true});
  fs.writeFileSync(path.join(destination, name), bytes, {flag: 'wx'});
}
copy('design.json');
copy('dataset.json');
const index = JSON.parse(fs.readFileSync(path.join(destination, 'dataset.json')));
if (!Array.isArray(index.body?.parts) || index.body.parts.length > 10000)
  throw Error('invalid partition index');
for (const p of index.body.parts) {
  if (
    !['fit', 'holdout'].includes(p.split) ||
    !Number.isSafeInteger(p.rep) ||
    p.rep < 0 ||
    p.rep > 10000
  )
    throw Error('invalid partition');
  if (p.file !== p.split + '/' + p.rep + '.jsonl' && p.file !== p.split + '\\' + p.rep + '.jsonl')
    throw Error('invalid partition filename');
  const dir = fs.lstatSync(path.join(source, p.split));
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error('linked partition directory');
  copy(p.split + '/' + p.rep + '.jsonl');
}
const ds = openDataset(destination);
for (const p of ds.index.body.parts) ds.episodes(p.split, p.rep);
console.log(JSON.stringify({partitions: ds.index.body.parts.length, bytes: total}));
