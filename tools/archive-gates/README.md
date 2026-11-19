# Archive source and backend gates

These baselines were captured from the clean runner, experiments and inputs at
`dd4c5439a241d6b4ebefa6f73a16875907686977` (Linux, Node 24.22.3; Bend 2.0.40
for the real backends), before the repository layout move. No existing archive
is used as an input to either gate.

- `node tools/archive-gates.mjs check` checks 31 training manifests. For each,
  reconstruct the exact flat `toolchain.sources` map by adding its `sources`
  to `commonSources` in [sources.json](sources.json). This is the runner's final
  compile input, including generated `runs/NAME/code/study.bend` and world adapters, not a
  guessed dependency list. The runner receives an inert compiler through its
  existing test seam, saves a temporary archive and selects an empty shard.
  The gate must not publish a trial, call Bend, or retain the stub backend.
- The same command checks all 26 `agentFile` and `worldFile` uses. Their entry
  module identities and all bundled source SHA-256 digests come from resolving
  and validating the real manifest. Repeated references are retained under
  their arm or world IDs. JSON world files contribute through the normalized
  plan and generated modules, including evaluation worlds. Collection,
  fitting, scoring, confirmation and assessment specifications are not
  themselves training manifests.
- `node tools/archive-gates.mjs check-backends` uses Bend on the host for
  eight small representative plans: built-in discrete with a custom agent,
  CartPole, Mountain Car, expanded finite table (current and previous
  observation), grid/step budget, packed finite table, custom Bend discrete
  world, and custom Bend arena. It verifies the real `toolchain.backend` with
  Bend 2.0.40 and runs no trials. CI runs this on Linux, where it installs Bend,
  and checks source and bundle identity on both Linux and Windows.

Never regenerate the checked-in baselines to make a move pass. Use `capture`
and `capture-backends` to write candidate artifacts to another location and
diff them instead. If an M0 runner change is deliberately necessary and
reviewed, `check path/to/exceptions.json` accepts a map of flat runner ES-module
names to exact `{"before":"old-64-hex-SHA-256","after":"new-64-hex-SHA-256"}`
pairs. The normal check starts with an empty exception set. List the exact
files, hashes and reasons in the change summary and pass that file to both CI
jobs. Exceptions cannot permit missing or added archive names, plan changes,
Bend byte changes, bundle identity changes or backend drift.

## Archive dependency boundary

The archived entry is `runs/NAME/code/experiment.mjs`. Its transitive static local dependencies
are `runs/NAME/code/experiment_config.mjs`, `runs/NAME/code/agent_source.mjs`, `runs/NAME/code/finite_world.mjs`,
`runs/NAME/code/packed_world.mjs`, and `runs/NAME/code/process_output.mjs`. The archived assessment path
imports `runs/NAME/code/assessment.mjs`, which imports the shared entry and config and reads
the sealed `runs/NAME/code/backend.mjs`. Resume/replay/rerun also load that backend.
Parallel resume imports `runs/NAME/code/parallel_trials.mjs`, which forks itself to
supervise and forks `runs/NAME/code/experiment.mjs` for workers. The generated files and
custom bundles in the source maps close the Bend import graph; built-in
`Base` belongs to the pinned compiler. The gate checks direct relative
imports, flat portable names (including case-insensitive collisions), and the
actual staged file hashes. The dynamic archived paths listed here are
additional runtime contracts, not a claim that a static matcher proves
arbitrary JavaScript call graphs.

`report` is a **live checkout** command. Its dynamic `core/html_report.mjs` plus
`analyze.py`, public-oracle and presentation helpers are not archived; the
checkout report deliberately reads the sealed runner, config, and backend via
absolute paths. The compiler path that imports the generated study ES module before sealing
also belongs to staging only. Studio training and catalog workers and MCP
launchers live in the checkout; they must continue calling the archive
paths/version recorded by the run. Offline fitted policy bundles use a separate
`runs/NAME/code/fitter.mjs` layout and are not experiment source snapshots.

## Moving files without changing archived identities

- Lift the live-source path lookup away from the archive filename. Never make
  an archived module import an application wrapper, a checkout parent, or a
  source location available only in the repository. The likely first M0
  exception is `experiment.mjs` **only** if this separation requires changing
  the copy that is actually archived. The eight archived JS basenames are
  enumerated in the source baseline; an application-only wrapper move does
  not authorize their byte changes.
- `bundleAgent` compares resolved paths against its standard-library root.
  Moving a raw Bend source or updating its import spelling can change its
  entry identity through rewritten imports or line endings; leave resolved
  standard library imports and their archived flat module names equivalent.
  Source and bundle fingerprints are raw bytes; for Windows, the existing
  Bend source and the eight archive-runtime names need LF checkouts. This is
  scoped in `.gitattributes`, not a change to anyone's Git configuration.
- Preserve the plan-relative `file`, `worldFile`, and `agentFile` references
  and equivalent resolved plan. Freeze comparison uses archived bytes and
  the recorded Node version. Never rewrite source snapshots, re-seal
  `run.json`, change checkpoint paths, or train to update old archives.
  The separate archived replay/resume smoke tests protect that boundary.
