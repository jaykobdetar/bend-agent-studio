# Experiment inputs at a glance

validate_plan/start_run also accept self-contained plan objects; validate_world/solve_world/evaluate_policy_exact/build_memory_world accept inline world objects. For inline plans use games[].definition for finite/grid worlds; custom source and file references require path-backed plans.

All paths in a tool call are relative to the configured workspace (absolute paths inside it also work). References **inside a training plan** are relative to the plan file. Numbers used for counts, checkpoints and seeds are nonnegative integers; the underlying validators enforce U32 bounds, disjoint seeds, domains and model compatibility.

| Input | Fields and meaning | Shipped example |
|---|---|---|
| Training plan | `schema:1`, lowercase `name`, nonempty `games` and `arms`, `replicates`, increasing `checkpoints`, `validationEpisodes`, `testEpisodes`, `seeds:{train,validation,test,stride}`. Optional `evaluationGames`; `budgetUnit` is episodes or steps (step budgets need `maxTrainEpisodes`). | experiments/bridge.json |
| Game | `id,limit`; built-in ID, or a JSON `file` / inline `definition`, or a Bend `worldFile` plus optional `domain,parameters`. | experiments/inventory.json |
| Arm | `id,method`; method-dependent `alpha,epsilon,gamma,planningSteps,criticRate,observation`. Custom arms use `agentFile,parameters,domain`. | experiments/custom-bandit.json |
| World | `schema:1, initial:[{to,weight}], states:[{id,observation?,actions:[{id,outcomes:[{to,weight,reward}]}]}]`. No actions means terminal. Grid worlds follow the grid schema, expanded by validate_world. | worlds/bridge.json; worlds/detour.json |
| Memory | `schema:1,states,initial,observationStride,otherwise,rules`. Rules update a finite memory state from the public transition. | worlds/reward-memory-rules.json |
| Select | `name,metric,reference,replicates,checkpoints,validationEpisodes,testEpisodes,seeds`, optional `maxTrainEpisodes`. Screen one game without test episodes; confirmation uses fresh seeds. | experiments/car-confirmation.json |
| Assess | `schema:1,name,comparisons:[{id,source,arm,checkpoint,minimumBudget?}],targets,episodes,seeds:{start,stride}`. Checkpoint can be a budget, final, or best-validation. | experiments/ledge-assessment.json |
| Collect | `schema:1,name,game,arm,checkpoint,epsilon,fitEpisodes,holdoutEpisodes,seeds:{fit,holdout,stride}`. | experiments/dispatch-exploring.json |
| Fit | `schema:1,name,arms:[{id,method,iterations?,gamma?}]`, where method is behavior_cloning, fitted_q or supported_fitted_q. | experiments/dispatch-fit.json |
| Score | `schema:1,name,episodes,seeds:{start,stride}`. Dataset, run and fitted policies must share lineage. | experiments/dispatch-score.json |
| Sequential test | `design:{lower,upper,margin?,alpha?,comparisons?}, rows:[{replicate,candidate,reference}]`. Declare bounds externally; contiguous paired replicates start at zero. | analysis/sequential.mjs |

Use the experiments guide for full semantics and the tool schemas for arguments. The normalized plan contains bundled code and internal derived fields: edit the source plan, not the normalized return.
