import {readFileSync, writeFileSync} from 'node:fs';
import {stormReserve, variants} from './world.mjs';

function text(h, c) {
  const {definition} = stormReserve(h, c);
  return '{"schema":1,"initial":[{"to":1,"weight":1}],"states":[\n' +
    definition.states.map(s => JSON.stringify(s)).join(',\n') + '\n]}\n';
}
const args = process.argv.slice(2);
if (args.length === 3 && args[0] === '--emit') {
  process.stdout.write(text(Number(args[1]), Number(args[2])));
} else if (args.length === 1 && ['--write','--check'].includes(args[0])) {
  for (const [h, c] of variants) {
    const url = new URL(`reserve-${h}x${c}.json`, import.meta.url);
    if (args[0] === '--write') writeFileSync(url, text(h, c));
    else if (readFileSync(url, 'utf8') !== text(h, c)) throw Error('Regeneration differs: ' + url.pathname);
  }
} else {
  throw Error('use --check, --write, or --emit <periods> <capacity>');
}
