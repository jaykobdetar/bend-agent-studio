// Compatibility CLI/import entry; authoritative implementation lives in core.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from './core/experiment.mjs';
export * from './core/experiment.mjs';
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
