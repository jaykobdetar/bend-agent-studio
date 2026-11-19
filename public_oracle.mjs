// Compatibility CLI/import entry; authoritative implementation lives in core.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from './core/public_oracle.mjs';
export * from './core/public_oracle.mjs';
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {main(process.argv.slice(2));} catch(error) {console.error(error.message);process.exitCode=1;}
}
