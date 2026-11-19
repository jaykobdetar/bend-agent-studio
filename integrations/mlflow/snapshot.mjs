import path from 'node:path';
import {exportCsv, manifestPath, status, unseal} from '../../core/experiment.mjs';

const root = path.resolve(process.argv[2]);
const sealed = unseal(manifestPath(root));
status(root, true);
const csv = exportCsv(root);
if (unseal(manifestPath(root)).hash !== sealed.hash) throw Error('run changed while exporting');
process.stdout.write(JSON.stringify(sealed) + '\n' + csv);
