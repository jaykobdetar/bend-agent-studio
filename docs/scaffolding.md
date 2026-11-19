# Scaffold a plan or build a sweep

From the repository root, use these commands to create one new starter at a
time. Names must start with a lower-case letter and may contain lower-case
letters, digits, hyphens and underscores (up to 64 characters). The commands
refuse existing paths; they do not update or delete user files.

- `node experiment.mjs init agent starter` creates an agent, a placeholder law
  and proof, a numerical check, a README and an example plan under the new
  agent directory. Validate the example before changing the policy. Run the
  generated checks and proof under pinned Bend and Lean.
- `node experiment.mjs init world one-step` writes a two-state finite JSON
  world. Add `--bend` to generate the equivalent typed Bend world instead.
- `node experiment.mjs init plan demo` writes a minimal, self-contained
  one-game plan with disjoint train, validation and test seeds.

Bend starters import the known core modules from this installation. For a
workspace outside the checkout, use a location on the same drive with a
relative path to the installation made of letters, digits, periods, hyphens
and underscores; Bend 2.0.40 import syntax does not accept spaces.

## Expand a grid or sample it reproducibly

Write a JSON sweep spec beside your local base plan (this example uses a
Q-learning arm named `q`):

```json
{
  "schema": 1,
  "plan": "base.json",
  "arm": "q",
  "grid": {
    "alpha": [0.125, 0.25, 0.5],
    "epsilon": [0.0625, 0.125, 0.25]
  },
  "random": {"seed": 248, "count": 4}
}
```

Run `node experiment.mjs sweep SPEC OUT`. Omit `random` to enumerate every
combination. The seeded mode samples distinct combinations without replacement;
the sweep seed controls only sampling, not experiment seeds. Keys are
processed in sorted order, and the output contains stable unique arm IDs.
The spec may contain up to 65,536 discrete combinations, but at most 512 can be emitted.
The planner rejects duplicate effective settings (including collisions after
float or exploration-bucket quantization), unknown arm settings, invalid
plans and seed blocks. A custom arm uses its declared named parameters as axes.
The output embeds the referenced worlds and source bundles so it can be
written outside the spec directory without breaking relative inputs.

The base must describe one game, with no transfer games. The sweep keeps its
replicates, checkpoints, train block and validation block while disabling held-out
tests. It is screening, not confirmation: use the existing validation-only
selection workflow and then a separately seeded confirmation plan.

## Optional successive halving

Add, for example, `"halving": {"factor": 2, "checkpoints": [8, 32, 128]}`
to the spec. The rungs must be increasing positive checkpoints already in the
base plan and must end at its final checkpoint. This mode supports 2–12 rungs,
factors 2–8, and at most 128 arm/replicate trials (32 declared checkpoints).
Generate the sweep manifest as usual, then run all arms through the first rung:

```sh
node experiment.mjs run "$SCREEN" runs/screen --until 8
node experiment.mjs sweep "$SPEC" "$RUNG_OUT" --halving runs/screen
```

The decision contains completed validation rankings, survivors, and the next
`shard` and `until` for each remaining trial. Apply those with
`node experiment.mjs resume runs/screen --shard I/N --until CHECKPOINT`, then
request the next decision in a fresh JSON file. When the active trials have
completed the final rung the decision includes a winner. At each rung it ranks
mean validation return across matched replicates, breaking ties by arm ID. It
never ranks an incomplete rung, reads held-out scores or asks you to train an
eliminated arm. It does not consider samples at a later checkpoint until the
earlier rung is complete. The final archive intentionally lacks later
checkpoints for eliminated arms, so ordinary full-study verification is not an
acceptance check for a halved run. The planner verifies each consulted
checkpoint's seal and parent chain and rejects nonempty test results.

## MCP

`init_agent`, `init_world` and `init_plan` take `name`; `init_world`
also accepts optional `bend`. These tools write under the configured workspace.
`sweep` takes `spec` and `out`, both workspace paths, and optional `halvingRun` to produce a rung decision. Its base plan and
referenced inputs are confined by the same rules as `validate_plan`. None of
these tools overwrites a file or provides an arbitrary writer.
