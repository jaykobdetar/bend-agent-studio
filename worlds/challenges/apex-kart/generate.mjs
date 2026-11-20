import fs from 'node:fs';
import {courses, kartWorld} from './kart.mjs';
const [mode, ...other] = process.argv.slice(2);
if (!['--write','--check'].includes(mode) || other.length) throw Error('use --write or --check');
for (const [id, design] of Object.entries(courses)) {
  const {initial, states} = kartWorld(design);
  const text = '{"schema":1,"initial":' + JSON.stringify(initial) + ',"states":[\n' +
    states.map(s => JSON.stringify(s)).join(',\n') + '\n]}\n';
  const path = new URL(id + '.json', import.meta.url);
  if (mode === '--write') fs.writeFileSync(path, text);
  else if (fs.readFileSync(path, 'utf8') !== text) throw Error('kart fixture differs: ' + id);
}
