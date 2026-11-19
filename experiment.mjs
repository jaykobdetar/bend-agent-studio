// Compatibility CLI/import entry; authoritative implementation lives in core.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main as runCore} from './core/experiment.mjs';
import {scaffold, sweep} from './tools/scaffold.mjs';
export * from './core/experiment.mjs';
export async function main(argv) {
  const [command, a, b, ...rest] = argv;
  if (command === 'init') {
    if (!a || !b || (rest.length && (rest.length !== 1 || rest[0] !== '--bend')))
      throw Error('usage: node experiment.mjs init agent|world|plan NAME [--bend (world only)]');
    for (const name of scaffold(process.cwd(), a, b, {bend: rest.length === 1}).created)
      console.log(name);
    return;
  }
  if (command === 'sweep') {
    if (!a || !b || (rest.length && (rest.length !== 2 || rest[0] !== '--halving')))
      throw Error('usage: node experiment.mjs sweep SPEC OUT [--halving RUN]');
    const result = sweep(a, b, {halvingRun: rest[1]});
    if (rest.length) console.log(result.winner ? `${b}: selected ${result.winner}.` :
      `${b}: ${result.next.length} shards to advance to the next validation rung.`);
    else console.log(`${b}: ${result.arms} screening arms, validation only.`);
    return;
  }
  return runCore(argv);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
