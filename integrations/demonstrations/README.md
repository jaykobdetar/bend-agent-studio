# Teach a finite-world policy

Drive one episode in your terminal, then see whether a small Bend behavior clone repeats your choices. Alternatively, let a frozen clone drive while you recommend actions at the states it actually reaches. This is local turn-based play, not a real-time controller, neural network or browser capture.

## Try it in three commands

From the repository root with [Node 24.22.3 and Bend 2.0.40 on PATH](../../docs/testing.md#set-up-a-machine):

```sh
npm run teach -- play worlds/challenges/apex-kart/kart-sprint.json runs/my-drive.json --seed 1 --limit 32
npm run teach -- fit worlds/challenges/apex-kart/kart-sprint.json runs/my-driver.json runs/my-drive.json
npm run teach -- watch worlds/challenges/apex-kart/kart-sprint.json runs/my-driver.json
```

**First drive:** Enter a listed number or name, then press Return: **0 coast, 1 throttle, 2 brake, 3 left, 4 right**. The dashboard shows progress, lane, speed and the next corner. Try throttling on a straight; brake before a hairpin or move to its inside lane. `.` is straight, `l`/`r` are sweepers, and `L`/`R` are hairpins. See the [kart physics](../../worlds/challenges/apex-kart/README.md) for the exact rules.

**Review and save:** Type `help` for controls, `review` to inspect your choices or `quit` to discard. Once the episode ends or reaches its turn limit, type `save` to write the file shown. If that fails, the drive is still in memory: retry or type `save runs/another-drive.json`. Nothing is written before you save; closing the input without a successful save discards it. Existing files are never overwritten.

**Fit and watch:** Only `fit` needs Bend. It trains from the saved drive and scores the clone against the untrained policy on fresh simulator seeds. `watch` shows one rollout with named actions. The sprint is a deterministic, single-start track: one drive can teach a route, not general racing skill.

The same commands work on authored finite or grid JSON. Try `worlds/detour.json` for a grid with an ASCII map; other finite worlds show public observation and action IDs if they have no recognized display. Arbitrary Bend programs and continuous controls aren't supported.

## Coach the learner instead of driving

```sh
npm run teach -- label worlds/challenges/apex-kart/kart-sprint.json runs/my-driver.json runs/my-labels.json --seed 2
npm run teach -- fit worlds/challenges/apex-kart/kart-sprint.json runs/my-driver-v2.json runs/my-drive.json runs/my-labels.json --eval-seed 2000
```

In `label`, **the clone's proposed action is always applied**. Enter the action *you* would have chosen as the training label, **same** to endorse the proposal, or **skip** to supply no label. Your label never redirects the current episode or receives its reward. After each turn, the terminal shows the clone's played action separately from your label. Use `review`, `quit` and `save` as above. The second command trains a new policy on the union. Include all the earlier recordings that trained the frozen driver, not the fit report itself. A return drop is possible. Try the two-start **kart-ridge** course to expose the difference between copying a route and acting in unfamiliar states.

To recheck a recording without training, run `npm run teach -- verify WORLD RECORD`. The verifier replays the seed and every applied action, checking public reset, legal lists, rewards, terminal/truncated status and total return. For corrections it also verifies the frozen policy's proposals, legality of expert labels and the separation from applied actions. The file binds a normalized world hash, input mode, horizon and a content checksum. Fitting also rebuilds the frozen driver's frequency table from the original recordings it cites. These checks detect inconsistencies; they do not authenticate a person or prove the world was never changed and re-recorded.

## What the learner sees

- Each saved demonstration contributes one label per applied action. A learner-driven episode contributes only its non-skipped teacher labels. The [supervised Bend update](labels.bend) takes just an observation and target action; no fictional transition is constructed for an unexecuted target. Decisions use the existing offline Clone's most frequent legal action, breaking ties in public order. With no matching evidence the first legal action wins. It is a memoryless lookup policy: no sharing between nearby states, recovery guarantee or reward optimization.
- A fit report contains portable frequency rows, toolchain hashes, training references, label agreement on the fit data, and individual paired simulator scores. `watch` replays the data-only policy. Evaluation compares the fitted and empty versions of the same learner on paired fresh simulator seeds: both have the same initial seed per pair, and no test seed appears in their training recordings. Counts of unsupported decisions refer to absence of any demonstrated legal label in the current view. Fit agreement is not held-out accuracy; repeated seeds on a deterministic track need not create new situations.
- Interactive input and piped scripts are distinguished as `interactive-terminal` and `scripted-input`. This describes the input channel, not proof of who pressed a key. Fit recordings of one input mode and one horizon together. To coach with a real person, start from your own interactive drive, not the scripted fixture. No identity, free text, wall-clock timings, typed errors or background key events are recorded. The game files and results stay local. Real-world files should stay in the ignored `runs/` directory.
- **Not an off-policy evaluation dataset.** No behavior probabilities are known for a person's choices; none are invented. Do not import these episodes into the randomized logger's importance-sampling estimates. Evaluation uses new simulator runs, not a counterfactual return attributed to a correction label.
- Prototype bounds: up to 512 ticks per episode, 64 legal actions per visited view, 128 recordings/4096 visited ticks per fit, and 1024 evaluation episodes/65,536 potential ticks per policy. The same finite-world file and state caps apply as in [MCP playback](../../mcp/README.md#play-a-finite-world).

## Scripted kart comparison (no human participants)

The [original DAgger study, §5.1](https://arxiv.org/pdf/1011.0686#page=6) collected steering labels on *Super Tux Kart* states reached by the learner. This is a small analogy: turn-based discrete actions, known track, public integer observations, a tabular clone and a scripted, non-optimal teacher. It is not a replication of the pixel/joystick experiment.

Start with a left-lane Ridge demonstration (13 labels). Spend **13 more scripted labels** either on a second teacher-driven demonstration from the right lane or on the first 13 states a frozen learner visits from that *same* right-start seed. The learner took 28 ticks: all 13 labels disagreed with its applied action; 15 subsequent observations were skipped. The label budgets match, not time, ticks or selected states.

| Policy | Total labels | Return, left / right start | Exact mean, normal starts | Mean, forced second action |
|---|---:|---:|---:|---:|
| Initial demonstration | 13 | 11 / 0 | 5.5 | 4.6 |
| Second teacher-driven demonstration | 26 | 11 / 15 | 13.0 | 7.8 |
| Labels on learner-visited states | 26 | 11 / 7 | 9.0 | 7.9 |

The second demonstration won under normal starts. On a right-lane rollout, the initial driver had **28 decisions with no demonstrated legal choice**. Learner-state labels reduced that to 4, versus zero for the second demonstration. A corrected choice can take the learner to a new state where nobody has taught it what to do next. The diagnostic intervenes once on tick two, equally weighting both start lanes × all five actions, then gives control back to the policy. Its 0.1-point difference is not evidence of general superiority. The 64 paired fresh seeds 1000–1063 happen to split 32/32 across the two lanes. They are not 64 tracks or independent trained agents.

Reproduce from the root; use a new directory. The [script](kart-study.mjs) saves the three scripted recordings, fits and [expected summary](kart-result.json). No person is needed.

```sh
node integrations/demonstrations/kart-study.mjs runs/scripted-coaching
node --test integrations/demonstrations/checks.mjs
```
