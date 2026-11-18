// Potentially expensive archive checks must not delay cancel_job or protocol I/O.
import {context} from './context.mjs';
try {
  const [mode, root, name] = process.argv.slice(2);
  const ctx = context(root);
  const result =
    mode === 'archive'
      ? ctx.archiveInfo(name)
      : mode === 'tree'
        ? {directory: ctx.inspectTree(name)}
        : null;
  if (!result) throw Error('unknown preflight');
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
