// Compatibility entry point; the offline implementation lives in offline/.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from './offline/batch.mjs';
export * from './offline/batch.mjs';

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(e => {console.error(e.message); process.exitCode = 1;});
}
