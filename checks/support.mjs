// An absent compiler is optional for the Node-only suite. A present but broken
// compiler must still fail the integration tests that exercise it.
import {spawnSync} from 'node:child_process';

const probe = spawnSync(process.env.BEND ?? 'bend', ['version'], {timeout: 5000});
export const compilerTest = {
  skip: probe.error?.code === 'ENOENT' ? 'Bend executable unavailable' : false,
};
