# Export a Bend study to MLflow

Use Python 3.12 and the Node version recorded by the run. The exporter installs nothing into Studio or the runner. From the repository root:

```sh
python3.12 -m venv .venv/mlflow
.venv/mlflow/bin/python -m pip install --require-hashes -r integrations/mlflow/requirements-lock.txt
.venv/mlflow/bin/python integrations/mlflow/export_mlflow.py runs/bridge runs/bridge-mlflow
```

The output is a new local MLflow file tracking store. The exporter uses the official pinned **MLflow Skinny** tracking client, disables MLflow telemetry and does not start an HTTP server or contact a remote tracking service. This MLflow version includes the file backend but warns that upstream is deprecating it; keep the isolated version pinned unless the file-store test passes on a successor. The full MLflow UI is optional and is not installed by this lock. Use a separately provisioned compatible MLflow UI configured to read the output directory if desired.

Only trusted, completed training archives are accepted. The normal Bend verification validates the sealed plan, archived source/backend hashes and every checkpoint chain before the exporter creates its destination. The source archive is not modified. The target must not exist: repeated imports must use different directories and do not add duplicates to an existing store. An error while writing leaves an incomplete store, marked with `.bend-export-incomplete`; discard that output and choose a new directory after addressing the error.

One finished MLflow run represents a game, arm and independently trained replicate. Its parameters are derived from the sealed plan, selected game and arm; world definitions are represented by the run identity, not copied as arbitrary parameter text. Parameters are JSON strings except for the replicate number, which is a decimal string. Tags `bend.run_hash`, `bend.backend_hash`, `bend.version`, `bend.game`, `bend.arm` and `bend.replicate` identify the data.

Metrics use names such as `validation.return`, `train.reward_per_step` and `test.completion`. MLflow `step` is the checkpoint budget in the plan's units, not an ordinal or wall-clock timestamp. Undefined metrics are omitted, so test metrics only appear where held-out episodes were recorded. Points are per replicate; aggregate or pair matching replicates to reproduce the [analysis curves](../../docs/analysis.md). MLflow stores the points, not the plotter's bootstrap intervals.

The pinned Linux workflow trains a tiny fixture and uses a real file store to compare metric histories with `analysis/plot_curves.py`. It also tests duplicate, incomplete and corrupted archive rejection. To run it with the same environment:

```sh
.venv/mlflow/bin/python -m unittest discover -s integrations/mlflow -v
```
