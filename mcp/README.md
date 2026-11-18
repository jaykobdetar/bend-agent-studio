# Bend Agent Studio MCP server

A local, stdio-only Model Context Protocol adapter. MCP dependencies are isolated here; the CLI and Studio still require no npm dependencies. Requires **Node 24+**, **Bend 2.0.40** for compilation/training, and **Python 3** for summary and curves. Optional SVG export requires matplotlib. Run from a trusted checkout.

    npm ci --prefix mcp --ignore-scripts
    node mcp/server.mjs --workspace /absolute/path/to/owner-controlled/workspace

Configure that command in your MCP client's stdio server settings, for example:

    {
      "mcpServers": {
        "bend": {
          "command": "/absolute/path/to/node",
          "args": ["/absolute/path/to/bend-agent-studio/mcp/server.mjs",
                   "--workspace", "/absolute/path/to/bend-agent-studio"],
          "env": {"BEND": "/absolute/path/to/bend"}
        }
      }
    }

Use the project checkout as workspace to operate on the shipped examples. Alternatively copy input JSON and all its local dependencies into a dedicated workspace. An agent can author self-contained plans and finite/grid worlds directly as tool arguments, even in an empty workspace. An editor is only needed for file-backed plans and custom Bend modules. There is intentionally no arbitrary file writer, raw shell, or general command tool. Set the optional **BEND_MCP_NODE_MAP** environment variable to a JSON object mapping exact Node versions (without leading v) to absolute executables, e.g. `{"24.22.3":"/opt/node-24.22.3/bin/node"}`. A mapped runtime is version-checked before archived execution. The current matching runtime is reused.

## A complete loop

1. Call `validate_world {"world":"worlds/bridge.json"}` and `solve_world {"world":"worlds/bridge.json","horizon":2,"kind":"history"}`.
2. Call `validate_plan {"plan":"experiments/bridge.json"}`. Inspect normalized settings and seed allocations.
3. Call `start_run {"plan":"experiments/bridge.json","out":"bridge-study"}`. Save its jobId; poll `job_status {"jobId":"…"}` until completed. Failed and cancelled jobs still report their exit and stderr. Use a new output directory for another run or resume an existing trusted run.
4. Call `summarize_results {"run":"bridge-study","phase":"test","metric":"return","reference":"random"}`. A replicate, not an individual episode, is the unit of inference.
5. Call `explain_episode {"run":"bridge-study","game":"bridge","arm":"q","replicate":0,"checkpoint":256,"phase":"test","episode":0,"offset":0,"limit":10}` for the per-action public-history oracle gap. Use the same coordinates with replay_episode to see the frames. Follow nextOffset until null.

## Author from an empty workspace

No example files are required. Pass `{"world":{"schema":1,"grid":["SG"],"goalReward":1},"horizon":1}` to **solve_world**. Then pass this object to **start_run** (omit `out` when calling **validate_plan** first):

```json
{
  "plan": {
    "schema": 1,
    "name": "one-step",
    "games": [{"id":"hall","limit":1,"definition":{"schema":1,"grid":["SG"],"goalReward":1}}],
    "arms": [{"id":"uniform","method":"random"}],
    "replicates": 2,
    "checkpoints": [0,2],
    "validationEpisodes": 2,
    "testEpisodes": 2,
    "seeds": {"train":10,"validation":100,"test":200,"stride":10}
  },
  "out": "first-study"
}
```

Both validations are read-only. An inline run validates its data and saves the original, reusable plan as `first-study/input-plan.json` before training. The filename is fixed and the output must not exist. Failed validation can leave an empty output directory but publishes neither a source plan nor a run. Do not feed the derived normalized validation response back as a source plan. For inline requests, embed worlds in `games[].definition`; use path-backed plans for relative files, custom agents or custom Bend worlds. A training plan itself may contain multiple distinct world definitions.

## Surface

- **Author/check:** list_examples, validate_plan, validate_world, solve_world (full/reactive/history/clock), evaluate_policy_exact (JSON observation keys to action ID or probability vector in legal-action order), build_memory_world, check_bend.
- **Jobs:** start_run, resume_run, rerun, start_assessment, start_offline (collect/fit/score), job_status, cancel_job. select_confirmation is synchronous.
- **Inspect:** list_runs, verify_run, summarize_results, learning_curve, get_checkpoint, replay_episode, explain_episode, sequential_test, arena_tournament. The last returns separate rating and cross-play tables. Verification requires a complete run; status can report a partial one.
- **Resources:** bend://docs/experiments, bend://docs/fields, bend://docs/laws, bend://studio/catalog.
- Successful tools return structuredContent and matching JSON text for older clients. Failures return isError and a structured error message. No CLI progress enters protocol stdout. Resource and tool listings describe supported inputs; unknown properties are refused.

## Trust, limits and recovery

**The workspace is a code-trust boundary, not a sandbox.** Archived runners/backends are executable code and custom Bend inputs are compiled. Use a directory controlled by you, not a writable shared or downloads folder. Do not import arbitrary third-party archives. A self-consistent checksum detects accidental changes but does not authenticate the author. Use OS isolation/least privilege when evaluating code. Do not change workspace contents concurrently with a call; checks do not defend against a hostile local filesystem writer. Symlinks and special files are rejected at user-selected paths and throughout archive trees. Parents of output directories must already exist. Outputs are newly reserved directories, except resume_run, which intentionally fills missing checkpoints in place.

One background job per server, up to eight concurrent calls. Cancellation remains available even when the ordinary call slots are full. Snapshot preflight runs in a bounded child and concurrent progress polls share a short-lived result. Job history is process-local (128 most recent jobs). Background work runs outside the server; cancellation targets the process group (Windows: taskkill /T). A separate IPC supervisor watches each child group, so the loss of the MCP owner triggers termination even during synchronous training. As with any user-space supervisor, killing both the supervisor and owner simultaneously can leave descendants. After a crash, inspect partial outputs and check for running workers before resume. Scratch directories can remain after an unclean exit. Do not share a workspace between MCP servers writing the same run. Background training has no fixed completion deadline: poll, or cancel explicitly.

Oracle computations run in isolated workers (12 s deadline); replay is limited to 30 s. Responses are capped at 1 MiB before the compatibility text copy; frames/decisions at 250 items and 256 KiB per page; opt-in models at 128 KiB. Partial live training cursors are never returned. On model opt-in, modelCanonical contains the exact JSON text hashed by modelHash (including signed zero); model is also returned as a convenience unless its nesting exceeds 128 levels. An oversized underlying replay/export is rejected, not silently truncated. Runs above 200,000 planned checkpoints or files, snapshots above 128 MiB, or individual run files above 64 MiB exceed this local adapter's limits. Calls with optional writes, including learning_curve (SVG) and build_memory_world, do not advertise read-only hints. Inspection-only tools do. check_bend supports Base and conventional relative module imports; it is not an arbitrary Bend script runner.

## Tests

    npm ci --prefix mcp --ignore-scripts
    BEND=/path/to/bend npm test --prefix mcp
    BEND=/path/to/bend npm test

Compiler-dependent tests skip if Bend is absent. The suite exercises raw protocol and official SDK clients, actual training, replay, oracle explanation, cancellation, rejected paths, and full offline workflows. To run the cross-version replay/resume test, set BEND_MCP_TEST_OTHER_NODE to an absolute path to a different Node 24 executable. The SVG test runs when matplotlib is available. Windows CI exercises the Node-only suite; POSIX-only lifecycle checks are explicitly marked.
